import { NextRequest, NextResponse } from "next/server"
import { OrderStatus, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { extractOrderPaymentDetails } from "@/lib/payment-details"
import { normalizeScheduleSelections } from "@/lib/ticket-schedule"

export const dynamic = "force-dynamic"

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100000 // permite exportar todo con un pageSize grande

const STATUS_VALUES = new Set<OrderStatus>([
    OrderStatus.PAID,
    OrderStatus.PENDING,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
])

// Convierte un campo @db.Date (medianoche UTC) a "YYYY-MM-DD" sin desfase de
// zona horaria. El cliente lo formatea interpretándolo como UTC.
function toCalendarDate(date: Date | null | undefined): string | null {
    if (!date) return null
    return date.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const page = Math.max(1, Number(searchParams.get("page") || "1"))
        const pageSize = Math.min(
            PAGE_SIZE_MAX,
            Math.max(1, Number(searchParams.get("pageSize") || String(PAGE_SIZE_DEFAULT)))
        )
        const search = searchParams.get("search")?.trim() || ""
        const statusParam = (searchParams.get("status") || "all").toUpperCase()

        // Búsqueda por cliente (nombre/email) o referencias de orden/pago.
        const searchFilter: Prisma.OrderWhereInput = search
            ? {
                  OR: [
                      { user: { name: { contains: search, mode: "insensitive" } } },
                      { user: { email: { contains: search, mode: "insensitive" } } },
                      { id: { contains: search, mode: "insensitive" } },
                      { providerOrderNumber: { contains: search, mode: "insensitive" } },
                      { providerTransactionId: { contains: search, mode: "insensitive" } },
                      { providerRef: { contains: search, mode: "insensitive" } },
                  ],
              }
            : {}

        const baseWhere: Prisma.OrderWhereInput = {
            orderType: "TICKET",
            ...searchFilter,
        }

        const statusWhere: Prisma.OrderWhereInput =
            statusParam !== "ALL" && STATUS_VALUES.has(statusParam as OrderStatus)
                ? { ...baseWhere, status: statusParam as OrderStatus }
                : baseWhere

        const [orders, total, statusTotals] = await Promise.all([
            prisma.order.findMany({
                where: statusWhere,
                include: {
                    user: { select: { name: true, email: true } },
                    orderItems: {
                        select: {
                            id: true,
                            ticketTypeId: true,
                            quantity: true,
                            unitPrice: true,
                            subtotal: true,
                            attendeeData: true,
                            ticketType: {
                                select: {
                                    name: true,
                                    price: true,
                                    event: {
                                        select: {
                                            title: true,
                                            category: true,
                                            eventDays: {
                                                select: { date: true, openTime: true, closeTime: true },
                                                orderBy: { date: "asc" },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    tickets: {
                        select: {
                            id: true,
                            attendeeName: true,
                            attendeeDni: true,
                            status: true,
                            ticketCode: true,
                            ticketTypeId: true,
                            entitlements: {
                                select: { date: true, status: true },
                                orderBy: { date: "asc" },
                            },
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.order.count({ where: statusWhere }),
            // Totales globales por estado (respetan la búsqueda, no el tab de estado).
            prisma.order.groupBy({
                by: ["status"],
                where: baseWhere,
                _sum: { totalAmount: true },
                _count: { _all: true },
            }),
        ])

        const sumForStatus = (status: OrderStatus) => {
            const row = statusTotals.find((item) => item.status === status)
            return row?._sum.totalAmount?.toNumber() ?? 0
        }
        const countForStatus = (status: OrderStatus) => {
            const row = statusTotals.find((item) => item.status === status)
            return row?._count._all ?? 0
        }

        const mappedOrders = orders.map((order) => {
            const paymentDetails = extractOrderPaymentDetails(order)

            return {
                id: order.id,
                totalAmount: order.totalAmount.toNumber(),
                status: order.status,
                provider: order.provider,
                providerRef: order.providerRef,
                providerOrderNumber: order.providerOrderNumber,
                providerTransactionId: order.providerTransactionId,
                paymentOperationNumber: paymentDetails.operationNumber,
                paymentSyncAttempts: order.paymentSyncAttempts,
                paymentLastSyncAt: order.paymentLastSyncAt,
                paymentNeedsReview: order.paymentNeedsReview,
                createdAt: order.createdAt,
                paidAt: order.paidAt,
                documentType: order.documentType,
                buyerName: order.buyerName,
                buyerDocNumber: order.buyerDocNumber,
                user: order.user,
                items: order.orderItems.map((item) => {
                    // Agregar día/turno comprado a partir de attendeeData.scheduleSelections.
                    const attendees = Array.isArray(item.attendeeData) ? item.attendeeData : []
                    const scheduleMap = new Map<string, { date: string; shift: string | null }>()
                    for (const attendee of attendees) {
                        if (!attendee || typeof attendee !== "object") continue
                        const selections = normalizeScheduleSelections(
                            (attendee as Record<string, unknown>).scheduleSelections
                        )
                        for (const selection of selections) {
                            const key = `${selection.date}::${selection.shift ?? ""}`
                            if (!scheduleMap.has(key)) scheduleMap.set(key, selection)
                        }
                    }
                    const schedule = Array.from(scheduleMap.values()).sort((a, b) =>
                        a.date.localeCompare(b.date)
                    )

                    const event = item.ticketType?.event

                    return {
                        id: item.id,
                        quantity: item.quantity,
                        subtotal: item.subtotal.toNumber(),
                        schedule,
                        ticketType: {
                            name: item.ticketType?.name ?? "",
                            price: item.unitPrice.toNumber(),
                            event: {
                                title: event?.title ?? "",
                                category: event?.category ?? "EVENTO",
                            },
                        },
                        eventDays: (event?.eventDays ?? []).map((day) => ({
                            date: toCalendarDate(day.date),
                            openTime: day.openTime,
                            closeTime: day.closeTime,
                        })),
                        tickets: order.tickets
                            .filter((ticket) => ticket.ticketTypeId === item.ticketTypeId)
                            .map((ticket) => ({
                                id: ticket.id,
                                attendeeName: ticket.attendeeName,
                                attendeeDni: ticket.attendeeDni,
                                status: ticket.status,
                                ticketCode: ticket.ticketCode,
                                entitlements: ticket.entitlements.map((entitlement) => ({
                                    date: toCalendarDate(entitlement.date),
                                    status: entitlement.status,
                                })),
                            })),
                    }
                }),
            }
        })

        return NextResponse.json({
            success: true,
            data: {
                orders: mappedOrders,
                totalPaid: sumForStatus(OrderStatus.PAID),
                totalPending: sumForStatus(OrderStatus.PENDING),
                totalCancelled: sumForStatus(OrderStatus.CANCELLED),
                paidOrdersCount: countForStatus(OrderStatus.PAID),
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / pageSize)),
                },
            },
        })
    } catch (error) {
        console.error("Error fetching income:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener ingresos" },
            { status: 500 }
        )
    }
}
