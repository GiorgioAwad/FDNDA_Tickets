import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import {
    buildServilexPayload,
    buildServilexPreviewSources,
    getServilexConfig,
    getServilexMissingConfig,
    type ServilexPayloadSource,
    type ServilexSourceOrder,
} from "@/lib/servilex"

export const dynamic = "force-dynamic"

function buildPreviewResponse(
    sources: ServilexPayloadSource[],
    orderStatus: string | null,
    mode: "order" | "mock",
    debugMode = false,
    extra: Record<string, unknown> = {}
) {
    const config = getServilexConfig()
    const missingConfig = getServilexMissingConfig(config)
    const payloads = sources.map((source) => ({
        groupKey: source.servilexGroupKey,
        groupLabel: source.servilexGroupLabel,
        indicator: source.servilexIndicator,
        assignedTotal: source.servilexAssignedTotal,
        payload: buildServilexPayload(source, config),
    }))

    const responseHeaders = {
        "Cache-Control": "no-store",
        "X-Servilex-Preview-Mode": mode,
        "X-Servilex-Preview-Count": String(payloads.length),
        "X-Servilex-Order-Id": sources[0]?.orderId || "",
        "X-Servilex-Order-Status": orderStatus || "",
        "X-Servilex-Endpoint": config.endpoint,
        "X-Servilex-Warnings": missingConfig.join(",") || "none",
    }

    if (!debugMode) {
        return NextResponse.json({ payloads }, { headers: responseHeaders })
    }

    return NextResponse.json(
        {
            mode,
            orderId: sources[0]?.orderId || "",
            orderStatus,
            payloads,
            headers: {
                "Content-Type": "application/json",
                "X-ABIO-Token": config.token ? "***configurado***" : "NO CONFIGURADO",
                "X-ABIO-Signature": "***redacted***",
                "X-ABIO-Empresa": config.empresa,
            },
            endpoint: config.endpoint,
            warnings: missingConfig.map((item) => `${item} no esta configurado`),
            securityNotes: [
                "El body ya no incluye credenciales ABIO.",
                "La firma HMAC real no se expone en el navegador.",
            ],
            ...extra,
        },
        { headers: responseHeaders }
    )
}

function mapOrderToPreviewSource(order: {
    id: string
    provider: string
    providerRef: string | null
    providerResponse: unknown
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
    totalAmount: unknown
    paidAt: Date | null
    createdAt: Date
    user: { email: string }
    orderItems: Array<{
        quantity: number
        unitPrice: unknown
        attendeeData: unknown
        ticketType: {
            name: string
            servilexEnabled: boolean
            servilexIndicator: string | null
            servilexSucursalCode: string | null
            servilexServiceCode: string | null
            servilexDisciplineCode: string | null
            servilexScheduleCode: string | null
            servilexPoolCode: string | null
            servilexExtraConfig: unknown
            event: {
                id: string
                startDate: Date
            }
        }
    }>
}): ServilexSourceOrder {
    return {
        id: order.id,
        provider: order.provider,
        providerRef: order.providerRef,
        providerResponse: order.providerResponse,
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
        totalAmount: order.totalAmount,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
        user: { email: order.user.email },
        orderItems: order.orderItems.map((item) => ({
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            attendeeData: item.attendeeData,
            ticketType: {
                name: item.ticketType.name,
                servilexEnabled: item.ticketType.servilexEnabled,
                servilexIndicator: item.ticketType.servilexIndicator,
                servilexSucursalCode: item.ticketType.servilexSucursalCode,
                servilexServiceCode: item.ticketType.servilexServiceCode,
                servilexDisciplineCode: item.ticketType.servilexDisciplineCode,
                servilexScheduleCode: item.ticketType.servilexScheduleCode,
                servilexPoolCode: item.ticketType.servilexPoolCode,
                servilexExtraConfig: item.ticketType.servilexExtraConfig,
                event: {
                    id: item.ticketType.event.id,
                    startDate: item.ticketType.event.startDate,
                },
            },
        })),
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = request.nextUrl
        const orderId = searchParams.get("orderId")
        const ticketTypeId = searchParams.get("ticketTypeId")
        const debugMode = searchParams.get("debug") === "1"

        if (orderId) {
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

            const sources = buildServilexPreviewSources(
                mapOrderToPreviewSource(order),
                `preview-order-${order.id}`
            )

            return buildPreviewResponse(sources, order.status, "order", debugMode)
        }

        if (ticketTypeId) {
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

            const previewOrder: ServilexSourceOrder = {
                id: `preview-${ticketType.id}`,
                provider: "IZIPAY",
                providerRef: "PREVIEW-TX-001",
                providerResponse: {
                    transactionDetails: {
                        authorizationCode: "PREVIEW-AUTH-001",
                        transactionId: "PREVIEW-TX-001",
                        cardBrand: "VISA",
                        paymentMethod: "CARD",
                    },
                },
                documentType: "BOLETA",
                buyerDocType: "1",
                buyerDocNumber: "12345678",
                buyerName: "USUARIO DE PRUEBA",
                buyerFirstName: "USUARIO",
                buyerSecondName: "DE",
                buyerLastNamePaternal: "PRUEBA",
                buyerLastNameMaternal: "TEST",
                buyerAddress: "JR. NAZCA CDRA. 6 S/N LIMA",
                buyerUbigeo: "150101",
                buyerEmail: "test@fdnda.org.pe",
                buyerPhone: "999999999",
                currency: ticketType.currency,
                totalAmount: ticketType.price,
                paidAt: new Date(),
                createdAt: new Date(),
                user: { email: "test@fdnda.org.pe" },
                orderItems: [{
                    quantity: 1,
                    unitPrice: ticketType.price,
                    attendeeData: [{
                        name: "USUARIO DE PRUEBA",
                        dni: "12345678",
                        matricula: "0000001",
                    }],
                    ticketType: {
                        name: ticketType.name,
                        servilexEnabled: ticketType.servilexEnabled,
                        servilexIndicator: ticketType.servilexIndicator,
                        servilexSucursalCode: ticketType.servilexSucursalCode,
                        servilexServiceCode: ticketType.servilexServiceCode,
                        servilexDisciplineCode: ticketType.servilexDisciplineCode,
                        servilexScheduleCode: ticketType.servilexScheduleCode,
                        servilexPoolCode: ticketType.servilexPoolCode,
                        servilexExtraConfig: ticketType.servilexExtraConfig,
                        event: {
                            id: ticketType.event.id,
                            startDate: ticketType.event.startDate,
                        },
                    },
                }],
            }

            const sources = buildServilexPreviewSources(previewOrder, `preview-ticket-${ticketType.id}`)

            return buildPreviewResponse(sources, "PAID", "mock", debugMode, {
                ticketTypeId: ticketType.id,
                ticketTypeName: ticketType.name,
            })
        }

        return NextResponse.json(
            {
                error: "Falta parámetro: orderId o ticketTypeId",
                usage: {
                    fromOrder: "GET /api/admin/servilex-preview?orderId=<id>",
                    fromTicketType: "GET /api/admin/servilex-preview?ticketTypeId=<id>",
                    debug: "Agrega &debug=1 para incluir endpoint, headers y warnings del preview",
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
