import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import {
    buildServilexPayload,
    formatServilexJsonForDisplay,
    getServilexConfig,
    stringifyServilexJson,
} from "@/lib/servilex"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseJsonString(value: string | null): unknown {
    if (!value) return null

    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const orderId = request.nextUrl.searchParams.get("orderId") || ""
        const includeProviderResponse = request.nextUrl.searchParams.get("provider") === "1"
        const includeRawPayloads = request.nextUrl.searchParams.get("raw") === "1"

        if (!orderId) {
            return NextResponse.json(
                {
                    error: "Falta orderId",
                    usage: "GET /api/admin/servilex-order-payloads?orderId=<id>",
                },
                { status: 400 }
            )
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: {
                user: {
                    select: {
                        email: true,
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
                                        servilexSucursalCode: true,
                                    },
                                },
                            },
                        },
                    },
                },
                invoices: {
                    orderBy: {
                        createdAt: "asc",
                    },
                },
            },
        })

        if (!order) {
            return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
        }

        const config = getServilexConfig()

        const invoices = order.invoices.map((invoice) => {
            let currentPayload: unknown = null
            let currentPayloadError: string | null = null

            try {
                currentPayload = buildServilexPayload(
                    {
                        id: invoice.id,
                        orderId: invoice.orderId,
                        traceId: invoice.traceId,
                        invoiceNumber: invoice.invoiceNumber,
                        servilexIndicator: invoice.servilexIndicator,
                        servilexGroupKey: invoice.servilexGroupKey,
                        servilexGroupLabel: invoice.servilexGroupLabel,
                        servilexAssignedTotal: invoice.assignedTotal,
                        servilexSucursalCode: invoice.servilexSucursalCode,
                        alumnoSnapshot: invoice.alumnoSnapshot,
                        servilexPayloadSnapshot: invoice.servilexPayloadSnapshot,
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
                            user: {
                                email: order.user.email,
                            },
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
                                        servilexSucursalCode: item.ticketType.event.servilexSucursalCode,
                                    },
                                },
                            })),
                        },
                    },
                    config
                )
            } catch (error) {
                currentPayloadError =
                    error instanceof Error ? error.message : "No se pudo reconstruir el payload"
            }

            const requestPayload = parseJsonString(invoice.requestPayload)
            const requestPayloadDisplay = formatServilexJsonForDisplay(requestPayload)
            const currentPayloadDisplay = formatServilexJsonForDisplay(currentPayload)

            return {
                id: invoice.id,
                status: invoice.status,
                groupKey: invoice.servilexGroupKey,
                groupLabel: invoice.servilexGroupLabel,
                indicator: invoice.servilexIndicator,
                sucursal: invoice.servilexSucursalCode,
                assignedTotal: Number(invoice.assignedTotal),
                retryCount: invoice.retryCount,
                sentToProvider: invoice.sentToProvider,
                sentAt: invoice.sentAt,
                issuedAt: invoice.issuedAt,
                httpStatus: invoice.httpStatus,
                invoiceNumber: invoice.invoiceNumber,
                reciboHash: invoice.reciboHash,
                pdfUrl: invoice.pdfUrl,
                lastError: invoice.lastError,
                requestPayload,
                requestPayloadDisplay,
                requestSignaturePresent: Boolean(invoice.requestSignature),
                currentPayload,
                currentPayloadDisplay,
                currentPayloadError,
                ...(includeRawPayloads
                    ? {
                        requestPayloadRaw: invoice.requestPayload,
                        currentPayloadRaw: currentPayload ? stringifyServilexJson(currentPayload) : null,
                    }
                    : {}),
                providerResponse: includeProviderResponse ? invoice.providerResponse : undefined,
            }
        })

        return new NextResponse(
            stringifyServilexJson({
                order: {
                    id: order.id,
                    status: order.status,
                    provider: order.provider,
                    providerRef: order.providerRef,
                    totalAmount: Number(order.totalAmount),
                    currency: order.currency,
                    documentType: order.documentType,
                    paidAt: order.paidAt,
                    createdAt: order.createdAt,
                    invoiceCount: invoices.length,
                },
                servilex: {
                    enabled: config.enabled,
                    endpoint: config.endpoint,
                    terminal: config.terminal,
                },
                invoices,
            }),
            {
                headers: {
                    "Cache-Control": "no-store",
                    "Content-Type": "application/json; charset=utf-8",
                },
            }
        )
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Error obteniendo payloads Servilex"
        console.error("Servilex order payloads error:", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
