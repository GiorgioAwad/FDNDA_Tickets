import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { normalizeScheduleSelections } from "@/lib/ticket-schedule"
import {
    formatServilexTimestamp,
    getServilexConfig,
    buildServilexSignature,
    type ServilexConfig,
    type ServilexPayload,
} from "@/lib/servilex"

export const dynamic = "force-dynamic"

const roundCurrency = (value: number): number => Number(value.toFixed(2))
const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10)

const CARD_BRAND_MAP: Record<string, string> = {
    visa: "VISA",
    mastercard: "MASTERCARD",
    master_card: "MASTERCARD",
    amex: "AMEX",
    american_express: "AMEX",
    diners: "DINERS",
    diners_club: "DINERS",
}

const PAYMENT_METHOD_MAP: Record<string, string> = {
    debit_card: "005",
    debit: "005",
    credit_card: "006",
    credit: "006",
    transfer: "007",
    cash: "008",
    yape: "008",
    plin: "008",
}

function normalizeCardBrand(raw: unknown): string | null {
    if (typeof raw !== "string" || !raw.trim()) return null
    const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_")
    return CARD_BRAND_MAP[key] || raw.trim().toUpperCase()
}

function normalizeFormaPago(paymentMethodType: unknown): string | null {
    if (typeof paymentMethodType !== "string" || !paymentMethodType.trim()) return null
    const key = paymentMethodType.trim().toLowerCase().replace(/[\s-]+/g, "_")
    return PAYMENT_METHOD_MAP[key] || null
}

const allocateLineAmounts = (baseAmounts: number[], finalTotal: number): number[] => {
    const finalTotalCents = Math.round(finalTotal * 100)
    const baseCents = baseAmounts.map((amount) => Math.round(amount * 100))
    const totalBaseCents = baseCents.reduce((sum, amount) => sum + amount, 0)

    if (baseCents.length === 0) return []
    if (totalBaseCents <= 0) return baseCents.map(() => 0)

    const provisional = baseCents.map((amount, index) => {
        const ratio = (amount / totalBaseCents) * finalTotalCents
        return { index, cents: Math.floor(ratio), remainder: ratio - Math.floor(ratio) }
    })

    let assigned = provisional.reduce((sum, item) => sum + item.cents, 0)
    let remaining = finalTotalCents - assigned

    provisional
        .sort((a, b) => b.remainder - a.remainder)
        .forEach((item) => {
            if (remaining <= 0) return
            item.cents += 1
            assigned += 1
            remaining -= 1
        })

    return provisional
        .sort((a, b) => a.index - b.index)
        .map((item) => roundCurrency(item.cents / 100))
}

type MockOrder = {
    documentType: string | null
    buyerDocType: string | null
    buyerDocNumber: string | null
    buyerName: string | null
    buyerFirstName: string | null
    buyerSecondName: string | null
    buyerLastNamePaternal: string | null
    buyerLastNameMaternal: string | null
    buyerAddress: string | null
    buyerUbigeo: string | null
    buyerEmail: string | null
    buyerPhone: string | null
    currency: string
    totalAmount: number
    paidAt: Date | null
    createdAt: Date
    providerResponse: unknown
    user: { email: string }
    orderItems: Array<{
        quantity: number
        unitPrice: number
        attendeeData: unknown
        ticketType: {
            name: string
            servilexEnabled: boolean
            servilexIndicator: string | null
            servilexServiceCode: string | null
            servilexDisciplineCode: string | null
            servilexScheduleCode: string | null
            servilexPoolCode: string | null
            event: { id: string; startDate: Date }
        }
    }>
}

function getPaymentMetadata(order: MockOrder, config: ServilexConfig) {
    const providerResponse =
        order.providerResponse && typeof order.providerResponse === "object"
            ? (order.providerResponse as Record<string, unknown>)
            : null

    let cardBrand: string | null = null
    let formaPago: string | null = null
    let procedencia: string | null = null

    if (providerResponse) {
        const transactions = Array.isArray(providerResponse.transactions)
            ? (providerResponse.transactions as Array<Record<string, unknown>>)
            : null
        const tx0 = transactions?.[0]

        if (tx0) {
            cardBrand = normalizeCardBrand(
                tx0.paymentMethodType === "CARD"
                    ? tx0.brand ?? tx0.paymentMethodDetails
                    : tx0.paymentMethodType
            )
            formaPago = normalizeFormaPago(tx0.paymentMethodType)

            const txDetails = typeof tx0.transactionDetails === "object" && tx0.transactionDetails
                ? (tx0.transactionDetails as Record<string, unknown>)
                : null
            const cardCountry = txDetails?.cardCountry ?? tx0.cardCountry
            if (typeof cardCountry === "string") {
                procedencia = cardCountry.toUpperCase() === "PE" ? "N" : "I"
            }
        }

        const transactionDetails =
            typeof providerResponse.transactionDetails === "object" && providerResponse.transactionDetails
                ? (providerResponse.transactionDetails as Record<string, unknown>)
                : null

        if (transactionDetails && !cardBrand) {
            cardBrand = normalizeCardBrand(transactionDetails.cardBrand)
            formaPago = normalizeFormaPago(transactionDetails.paymentMethod)
        }
    }

    return {
        formaPago: formaPago || config.formaPago,
        tarjetaTipo: cardBrand || config.tarjetaTipo,
        tarjetaProcedencia: procedencia || config.tarjetaProcedencia,
    }
}

function buildPreviewPayload(order: MockOrder, config: ServilexConfig): ServilexPayload {
    const servilexItems = order.orderItems.filter((item) => item.ticketType.servilexEnabled)
    if (servilexItems.length === 0) {
        throw new Error("La orden no tiene items Servilex habilitados")
    }

    const indicators = Array.from(
        new Set(servilexItems.map((item) => (item.ticketType.servilexIndicator || "AC").trim()))
    )
    if (indicators.length !== 1) {
        throw new Error("La orden tiene indicadores Servilex inconsistentes")
    }

    const rawDetailLines = servilexItems.flatMap((item) => {
        const attendeeData = Array.isArray(item.attendeeData)
            ? (item.attendeeData as Array<Record<string, unknown>>)
            : []

        return Array.from({ length: item.quantity }, (_, index) => {
            const attendee = attendeeData[index] || {}
            const matricula =
                typeof attendee.matricula === "string" ? attendee.matricula.trim() : ""

            const selections = normalizeScheduleSelections(attendee.scheduleSelections)
            const selectedDate = selections[0]?.date
            const serviceDate = selectedDate
                ? new Date(`${selectedDate}T12:00:00Z`)
                : item.ticketType.event.startDate
            const year = String(serviceDate.getUTCFullYear())
            const month = String(serviceDate.getUTCMonth() + 1).padStart(2, "0")

            return {
                matricula: matricula || "TEST-MAT-001",
                servicio: item.ticketType.servilexServiceCode || "",
                disciplina: item.ticketType.servilexDisciplineCode || "",
                horario: item.ticketType.servilexScheduleCode || "",
                piscina: item.ticketType.servilexPoolCode || "",
                periodo: year,
                mes: month,
                precioBase: Number(item.unitPrice),
            }
        })
    })

    const allocatedPrices = allocateLineAmounts(
        rawDetailLines.map((line) => line.precioBase),
        Number(order.totalAmount)
    )

    const detalle = rawDetailLines.map((line, index) => ({
        matricula: line.matricula,
        servicio: line.servicio,
        disciplina: line.disciplina,
        horario: line.horario,
        piscina: line.piscina,
        periodo: line.periodo,
        mes: line.mes,
        precio: allocatedPrices[index] ?? 0,
    }))

    const total = roundCurrency(detalle.reduce((sum, item) => sum + item.precio, 0))
    const issueDate = toDateOnly(order.paidAt || order.createdAt)
    const buyerIsFactura = order.documentType === "FACTURA"
    const payment = getPaymentMetadata(order, config)

    const entidad: Record<string, unknown> = {
        tipoDocumento: order.buyerDocType || (buyerIsFactura ? "6" : "1"),
        numeroDocumento: order.buyerDocNumber || "",
        apellidoPaterno: buyerIsFactura ? "" : (order.buyerLastNamePaternal || ""),
        apellidoMaterno: buyerIsFactura ? "" : (order.buyerLastNameMaternal || ""),
        primerNombre: buyerIsFactura ? (order.buyerName || "") : (order.buyerFirstName || ""),
        segundoNombre: buyerIsFactura ? "" : (order.buyerSecondName || ""),
        direccion: order.buyerAddress || "",
        ubigeo: order.buyerUbigeo || "",
        email: order.buyerEmail || order.user.email,
        celular: order.buyerPhone || "",
    }

    const cabecera: Record<string, unknown> = {
        codigoEmp: config.codigoEmp,
        sucursal: config.sucursal,
        indicador: indicators[0],
        comprobante: {
            tipo: buyerIsFactura ? "FAC" : "BOL",
            serie: buyerIsFactura ? config.serieFactura : config.serieBoleta,
        },
        entidad,
        fechaEmision: issueDate,
        fechaVencimiento: issueDate,
        moneda: order.currency === "USD" ? "02" : "01",
        total,
        condicionPago: config.condicionPago,
        tipoTributo: config.tipoTributo,
        referencia: config.referencia,
        tipoRegistro: config.tipoRegistro,
    }

    if (config.ejecutivo) {
        cabecera.ejecutivo = config.ejecutivo
    }

    return {
        meta: {
            version: "1.0",
            traceId: `preview-${Date.now()}`,
            timestamp: formatServilexTimestamp(new Date()),
            terminal: config.terminal,
        },
        cabecera,
        detalle,
        cobranza: {
            formaPago: payment.formaPago,
            tarjetaTipo: payment.tarjetaTipo,
            tarjetaProcedencia: payment.tarjetaProcedencia,
            totalPago: total,
        },
    }
}

/**
 * GET /api/admin/servilex-preview?orderId=xxx
 *   → Builds the Servilex JSON payload from a real PAID order (dry-run, no send)
 *
 * GET /api/admin/servilex-preview?ticketTypeId=xxx
 *   → Builds a mock payload using a specific ticket type with sample data
 */
export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const config = getServilexConfig()
        const { searchParams } = request.nextUrl
        const orderId = searchParams.get("orderId")
        const ticketTypeId = searchParams.get("ticketTypeId")

        if (orderId) {
            // ── Mode 1: Preview from a real order ──
            const order = await prisma.order.findUnique({
                where: { id: orderId },
                include: {
                    user: { select: { email: true } },
                    orderItems: {
                        include: {
                            ticketType: {
                                include: {
                                    event: { select: { id: true, startDate: true } },
                                },
                            },
                        },
                    },
                },
            })

            if (!order) {
                return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
            }

            const mockOrder: MockOrder = {
                documentType: order.documentType,
                buyerDocType: order.buyerDocType,
                buyerDocNumber: order.buyerDocNumber,
                buyerName: order.buyerName,
                buyerFirstName: order.buyerFirstName,
                buyerSecondName: order.buyerSecondName,
                buyerLastNamePaternal: order.buyerLastNamePaternal,
                buyerLastNameMaternal: order.buyerLastNameMaternal,
                buyerAddress: order.buyerAddress,
                buyerUbigeo: order.buyerUbigeo,
                buyerEmail: order.buyerEmail,
                buyerPhone: order.buyerPhone,
                currency: order.currency,
                totalAmount: Number(order.totalAmount),
                paidAt: order.paidAt,
                createdAt: order.createdAt,
                providerResponse: order.providerResponse,
                user: { email: order.user.email },
                orderItems: order.orderItems.map((item) => ({
                    quantity: item.quantity,
                    unitPrice: Number(item.unitPrice),
                    attendeeData: item.attendeeData,
                    ticketType: {
                        name: item.ticketType.name,
                        servilexEnabled: item.ticketType.servilexEnabled,
                        servilexIndicator: item.ticketType.servilexIndicator,
                        servilexServiceCode: item.ticketType.servilexServiceCode,
                        servilexDisciplineCode: item.ticketType.servilexDisciplineCode,
                        servilexScheduleCode: item.ticketType.servilexScheduleCode,
                        servilexPoolCode: item.ticketType.servilexPoolCode,
                        event: {
                            id: item.ticketType.event.id,
                            startDate: item.ticketType.event.startDate,
                        },
                    },
                })),
            }

            const payload = buildPreviewPayload(mockOrder, config)
            const rawPayload = JSON.stringify(payload)
            const signature = buildServilexSignature(rawPayload, config.token || "test-token")

            return NextResponse.json({
                mode: "order",
                orderId: order.id,
                orderStatus: order.status,
                payload,
                signature,
                headers: {
                    "Content-Type": "application/json",
                    "X-ABIO-Token": config.token ? "***configurado***" : "NO CONFIGURADO",
                    "X-ABIO-Signature": signature,
                    "X-ABIO-Empresa": config.empresa,
                },
                endpoint: config.endpoint,
                warnings: !config.token ? ["SERVILEX_TOKEN no está configurado"] : [],
            })
        }

        if (ticketTypeId) {
            // ── Mode 2: Preview from a ticket type with mock data ──
            const ticketType = await prisma.ticketType.findUnique({
                where: { id: ticketTypeId },
                include: {
                    event: { select: { id: true, startDate: true } },
                },
            })

            if (!ticketType) {
                return NextResponse.json({ error: "Tipo de entrada no encontrado" }, { status: 404 })
            }

            if (!ticketType.servilexEnabled) {
                return NextResponse.json(
                    { error: "Este tipo de entrada no tiene Servilex habilitado" },
                    { status: 400 }
                )
            }

            const mockOrder: MockOrder = {
                documentType: "BOLETA",
                buyerDocType: "1",
                buyerDocNumber: "12345678",
                buyerName: "USUARIO DE PRUEBA",
                buyerFirstName: "USUARIO",
                buyerSecondName: "DE",
                buyerLastNamePaternal: "PRUEBA",
                buyerLastNameMaternal: "TEST",
                buyerAddress: "",
                buyerUbigeo: "150101",
                buyerEmail: "test@fdnda.org.pe",
                buyerPhone: "999999999",
                currency: ticketType.currency,
                totalAmount: Number(ticketType.price),
                paidAt: new Date(),
                createdAt: new Date(),
                providerResponse: {
                    transactions: [{
                        paymentMethodType: "CARD",
                        brand: "VISA",
                        cardCountry: "PE",
                    }],
                },
                user: { email: "test@fdnda.org.pe" },
                orderItems: [{
                    quantity: 1,
                    unitPrice: Number(ticketType.price),
                    attendeeData: [{
                        name: "USUARIO DE PRUEBA",
                        dni: "12345678",
                        matricula: "TEST-MAT-001",
                    }],
                    ticketType: {
                        name: ticketType.name,
                        servilexEnabled: ticketType.servilexEnabled,
                        servilexIndicator: ticketType.servilexIndicator,
                        servilexServiceCode: ticketType.servilexServiceCode,
                        servilexDisciplineCode: ticketType.servilexDisciplineCode,
                        servilexScheduleCode: ticketType.servilexScheduleCode,
                        servilexPoolCode: ticketType.servilexPoolCode,
                        event: {
                            id: ticketType.event.id,
                            startDate: ticketType.event.startDate,
                        },
                    },
                }],
            }

            const payload = buildPreviewPayload(mockOrder, config)
            const rawPayload = JSON.stringify(payload)
            const signature = buildServilexSignature(rawPayload, config.token || "test-token")

            return NextResponse.json({
                mode: "mock",
                ticketTypeId: ticketType.id,
                ticketTypeName: ticketType.name,
                payload,
                signature,
                headers: {
                    "Content-Type": "application/json",
                    "X-ABIO-Token": config.token ? "***configurado***" : "NO CONFIGURADO",
                    "X-ABIO-Signature": signature,
                    "X-ABIO-Empresa": config.empresa,
                },
                endpoint: config.endpoint,
                warnings: !config.token ? ["SERVILEX_TOKEN no está configurado"] : [],
            })
        }

        return NextResponse.json(
            {
                error: "Falta parámetro: orderId o ticketTypeId",
                usage: {
                    fromOrder: "GET /api/admin/servilex-preview?orderId=<id>",
                    fromTicketType: "GET /api/admin/servilex-preview?ticketTypeId=<id>",
                },
            },
            { status: 400 }
        )
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error generando preview"
        console.error("Servilex preview error:", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
