import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import {
    buildServilexPayload,
    getServilexConfig,
    getServilexMissingConfig,
    type ServilexPayloadSource,
} from "@/lib/servilex"

export const dynamic = "force-dynamic"

function buildRedactedPayload(source: ServilexPayloadSource) {
    const payload = buildServilexPayload(source, getServilexConfig())

    return {
        ...payload,
        seguridad: {
            ...payload.seguridad,
            usuario: payload.seguridad.usuario ? "***configurado***" : "",
            password: payload.seguridad.password ? "***configurado***" : "",
            token: payload.seguridad.token ? "***configurado***" : "",
        },
    }
}

function buildPreviewResponse(
    source: ServilexPayloadSource,
    orderStatus: string | null,
    mode: "order" | "mock",
    debugMode = false,
    extra: Record<string, unknown> = {}
) {
    const config = getServilexConfig()
    const payload = buildRedactedPayload(source)
    const missingConfig = getServilexMissingConfig(config)

    const responseHeaders = {
        "Cache-Control": "no-store",
        "X-Servilex-Preview-Mode": mode,
        "X-Servilex-Order-Id": source.orderId,
        "X-Servilex-Order-Status": orderStatus || "",
        "X-Servilex-Endpoint": config.endpoint,
        "X-Servilex-Warnings": missingConfig.join(",") || "none",
        "X-Servilex-Security-Redacted": "true",
    }

    if (!debugMode) {
        return NextResponse.json(payload, {
            headers: responseHeaders,
        })
    }

    return NextResponse.json({
        mode,
        orderId: source.orderId,
        orderStatus,
        payload,
        headers: {
            "Content-Type": "application/json",
            "X-ABIO-Token": config.token ? "***configurado***" : "NO CONFIGURADO",
            "X-ABIO-Signature": "***redacted***",
            "X-ABIO-Empresa": config.empresa,
        },
        endpoint: config.endpoint,
        warnings: missingConfig.map((item) => `${item} no está configurado`),
        securityNotes: [
            "Las credenciales Servilex fueron redactadas en esta respuesta.",
            "La firma HMAC real no se expone en el navegador.",
        ],
        ...extra,
    }, {
        headers: responseHeaders,
    })
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

            const source: ServilexPayloadSource = {
                id: `preview-order-${order.id}`,
                orderId: order.id,
                traceId: null,
                invoiceNumber: null,
                order: {
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
                },
            }

            return buildPreviewResponse(source, order.status, "order", debugMode)
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

            const source: ServilexPayloadSource = {
                id: `preview-ticket-${ticketType.id}`,
                orderId: `preview-${ticketType.id}`,
                traceId: null,
                invoiceNumber: null,
                order: {
                    id: `preview-${ticketType.id}`,
                    provider: "IZIPAY",
                    providerRef: "PREVIEW-TX-001",
                    providerResponse: {
                        messageUser: "Su compra ha sido exitosa.",
                        transactionDetails: {
                            authorizationCode: "PREVIEW-AUTH-001",
                            transactionId: "PREVIEW-TX-001",
                            cardBrand: "VISA",
                            maskedCardNumber: "411111******1111",
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
                },
            }

            return buildPreviewResponse(source, "PAID", "mock", debugMode, {
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
