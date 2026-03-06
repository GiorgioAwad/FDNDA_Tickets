import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { normalizeScheduleSelections } from "@/lib/ticket-schedule"
import {
    formatServilexTimestamp,
    getServilexConfig,
    sendServilexInvoice,
    type ServilexConfig,
    type ServilexPayload,
} from "@/lib/servilex"

type InvoiceQueueItem = Awaited<ReturnType<typeof loadInvoices>>[number]

const roundCurrency = (value: number): number => Number(value.toFixed(2))

const toDateOnly = (value: Date): string => value.toISOString().slice(0, 10)

const toJsonValue = (
    value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput => {
    if (value === undefined || value === null) return Prisma.JsonNull
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        Array.isArray(value) ||
        typeof value === "object"
    ) {
        return value as Prisma.InputJsonValue
    }
    return String(value)
}

const buildStableTraceId = (invoice: { traceId: string | null; id: string }) =>
    invoice.traceId || `req-${invoice.id}`

const allocateLineAmounts = (baseAmounts: number[], finalTotal: number): number[] => {
    const finalTotalCents = Math.round(finalTotal * 100)
    const baseCents = baseAmounts.map((amount) => Math.round(amount * 100))
    const totalBaseCents = baseCents.reduce((sum, amount) => sum + amount, 0)

    if (baseCents.length === 0) return []
    if (totalBaseCents <= 0) {
        return baseCents.map(() => 0)
    }

    const provisional = baseCents.map((amount, index) => {
        const ratio = (amount / totalBaseCents) * finalTotalCents
        return {
            index,
            cents: Math.floor(ratio),
            remainder: ratio - Math.floor(ratio),
        }
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

/**
 * Mapeo de marcas de tarjeta normalizadas al formato SERVILEX.
 */
const CARD_BRAND_MAP: Record<string, string> = {
    visa: "VISA",
    mastercard: "MASTERCARD",
    master_card: "MASTERCARD",
    amex: "AMEX",
    american_express: "AMEX",
    diners: "DINERS",
    diners_club: "DINERS",
}

/**
 * Mapeo del método de pago al código formaPago de SUNAT.
 * 005 = Tarjeta de Débito, 006 = Tarjeta de Crédito, 007 = Transferencia, 008 = Efectivo
 */
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

/**
 * Extrae metadatos del pago desde providerResponse.
 * Soporta:
 *  - IziPay embedded (kr-answer con transactions[])
 *  - IziPay redirect (transactionDetails.cardBrand)
 *  - Mock payments (cae en config defaults)
 *  - Cualquier otra pasarela (cae en config defaults)
 */
function getPaymentMetadata(order: InvoiceQueueItem["order"], config: ServilexConfig) {
    const providerResponse =
        order.providerResponse && typeof order.providerResponse === "object"
            ? (order.providerResponse as Record<string, unknown>)
            : null

    let cardBrand: string | null = null
    let formaPago: string | null = null
    let procedencia: string | null = null

    if (providerResponse) {
        // ── Formato embedded IziPay (kr-answer parsed) ──
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

        // ── Formato redirect IziPay ──
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

function buildServilexPayload(invoice: InvoiceQueueItem, config: ServilexConfig): ServilexPayload {
    const order = invoice.order
    const servilexItems = order.orderItems.filter((item) => item.ticketType.servilexEnabled)
    if (servilexItems.length === 0) {
        throw new Error("La orden no tiene items Servilex habilitados")
    }
    if (servilexItems.length !== order.orderItems.length) {
        throw new Error("La orden mezcla items con y sin Servilex")
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
            if (!matricula) {
                throw new Error(`Falta matricula Servilex en ${item.ticketType.name}`)
            }

            const selections = normalizeScheduleSelections(attendee.scheduleSelections)
            const selectedDate = selections[0]?.date
            const serviceDate = selectedDate
                ? new Date(`${selectedDate}T12:00:00Z`)
                : item.ticketType.event.startDate
            const year = String(serviceDate.getUTCFullYear())
            const month = String(serviceDate.getUTCMonth() + 1).padStart(2, "0")

            return {
                matricula,
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
            traceId: buildStableTraceId(invoice),
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

async function loadInvoices(maxJobs: number) {
    const config = getServilexConfig()
    return prisma.invoice.findMany({
        where: {
            order: {
                status: "PAID",
            },
            OR: [
                { status: "PENDING" },
                {
                    status: "FAILED",
                    retryCount: { lt: config.maxRetries },
                },
            ],
        },
        include: {
            order: {
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                        },
                    },
                    orderItems: {
                        include: {
                            ticketType: {
                                include: {
                                    event: {
                                        select: {
                                            id: true,
                                            startDate: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        orderBy: { createdAt: "asc" },
        take: maxJobs,
    })
}

async function markInvoiceIssued(invoice: InvoiceQueueItem, response: Awaited<ReturnType<typeof sendServilexInvoice>>) {
    const now = new Date()
    await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
            status: "ISSUED",
            traceId: buildStableTraceId(invoice),
            requestPayload: response.rawPayload,
            requestSignature: response.signature,
            httpStatus: response.status,
            providerResponse: toJsonValue(response.responseBody),
            reciboHash: response.reciboHash || invoice.reciboHash,
            pdfUrl: response.pdfUrl || invoice.pdfUrl,
            invoiceNumber: response.invoiceNumber || invoice.invoiceNumber,
            sentToProvider: true,
            sentAt: now,
            issuedAt: invoice.issuedAt || now,
            lastError: null,
        },
    })
}

async function markInvoiceFailed(
    invoice: InvoiceQueueItem,
    traceId: string,
    rawPayload: string | null,
    signature: string | null,
    status: number | null,
    responseBody: unknown,
    errorMessage: string
) {
    await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
            status: "FAILED",
            traceId,
            requestPayload: rawPayload,
            requestSignature: signature,
            httpStatus: status,
            providerResponse: toJsonValue(responseBody),
            sentAt: new Date(),
            retryCount: { increment: 1 },
            lastError: errorMessage,
        },
    })
}

let isProcessing = false

export async function getInvoiceQueueStats() {
    const [pending, failed, issued] = await Promise.all([
        prisma.invoice.count({ where: { status: "PENDING" } }),
        prisma.invoice.count({ where: { status: "FAILED" } }),
        prisma.invoice.count({ where: { status: "ISSUED" } }),
    ])

    return { pending, failed, issued }
}

export async function processInvoiceQueue(maxJobs: number = 10): Promise<{
    processed: number
    failed: number
    skipped: number
}> {
    const config = getServilexConfig()
    if (!config.enabled) {
        return { processed: 0, failed: 0, skipped: 0 }
    }
    if (isProcessing) {
        return { processed: 0, failed: 0, skipped: 0 }
    }

    isProcessing = true
    let processed = 0
    let failed = 0
    let skipped = 0

    try {
        const invoices = await loadInvoices(maxJobs)

        for (const invoice of invoices) {
            if (!config.token) {
                await markInvoiceFailed(
                    invoice,
                    buildStableTraceId(invoice),
                    null,
                    null,
                    null,
                    null,
                    "SERVILEX_TOKEN no configurado"
                )
                failed++
                continue
            }

            try {
                const payload = buildServilexPayload(invoice, config)
                const response = await sendServilexInvoice(payload, config)

                if (response.ok) {
                    await markInvoiceIssued(invoice, response)
                    processed++
                    continue
                }

                await markInvoiceFailed(
                    invoice,
                    buildStableTraceId(invoice),
                    response.rawPayload,
                    response.signature,
                    response.status,
                    response.responseBody,
                    response.errorMessage || "Error enviando invoice a Servilex"
                )
                failed++
            } catch (error) {
                const message = error instanceof Error ? error.message : "Error procesando invoice"
                await markInvoiceFailed(
                    invoice,
                    buildStableTraceId(invoice),
                    null,
                    null,
                    null,
                    null,
                    message
                )
                failed++
            }
        }

        skipped = Math.max(0, invoices.length - processed - failed)
    } finally {
        isProcessing = false
    }

    return { processed, failed, skipped }
}
