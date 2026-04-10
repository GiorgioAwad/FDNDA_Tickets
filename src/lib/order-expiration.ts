import { prisma } from "@/lib/prisma"
import { onTicketSold } from "@/lib/cached-queries"
import { buildPoolFreeReservationCounts, isPoolFreeEventCategory } from "@/lib/pool-free"
import { releaseTicketTypeDateInventory } from "@/lib/ticket-date-inventory"

const ORDER_EXPIRATION_MINUTES = 30
const MAX_ORDERS_PER_RUN = 200

export interface ExpirePendingOrdersResult {
    success: boolean
    processed: number
    expiredOrders: number
    releasedTickets: number
    cutoffDate: string
    timestamp: string
}

export async function expirePendingOrders(
    options?: {
        expirationMinutes?: number
        maxOrders?: number
    }
): Promise<ExpirePendingOrdersResult> {
    const expirationMinutes = options?.expirationMinutes ?? ORDER_EXPIRATION_MINUTES
    const maxOrders = options?.maxOrders ?? MAX_ORDERS_PER_RUN
    const cutoffDate = new Date(Date.now() - expirationMinutes * 60 * 1000)

    const pendingOrders = await prisma.order.findMany({
        where: {
            status: "PENDING",
            createdAt: { lte: cutoffDate },
            OR: [
                { provider: { not: "IZIPAY" } },
                { providerOrderNumber: null },
                { providerTransactionId: null },
            ],
        },
        select: {
            id: true,
        },
        orderBy: { createdAt: "asc" },
        take: maxOrders,
    })

    let expiredOrders = 0
    let releasedTickets = 0
    const invalidations = new Set<string>()

    for (const order of pendingOrders) {
        const result = await prisma.$transaction(async (tx) => {
            const cancelled = await tx.order.updateMany({
                where: {
                    id: order.id,
                    status: "PENDING",
                    createdAt: { lte: cutoffDate },
                },
                data: {
                    status: "CANCELLED",
                },
            })

            if (cancelled.count === 0) {
                return { expired: false, released: 0, keys: [] as string[] }
            }

            const orderItems = await tx.orderItem.findMany({
                where: { orderId: order.id },
                select: {
                    ticketTypeId: true,
                    quantity: true,
                    attendeeData: true,
                    ticketType: {
                        select: {
                            eventId: true,
                            validDays: true,
                            name: true,
                            event: {
                                select: {
                                    category: true,
                                    startDate: true,
                                    endDate: true,
                                },
                            },
                        },
                    },
                },
            })

            let released = 0
            const keys: string[] = []

            for (const item of orderItems) {
                if (isPoolFreeEventCategory(item.ticketType.event.category)) {
                    const reservationCounts = buildPoolFreeReservationCounts({
                        attendees: Array.isArray(item.attendeeData) ? item.attendeeData : [],
                        quantity: item.quantity,
                        validDays: item.ticketType.validDays,
                        eventStartDate: item.ticketType.event.startDate,
                        eventEndDate: item.ticketType.event.endDate,
                        ticketLabel: item.ticketType.name,
                        strict: false,
                    })

                    if (reservationCounts.size > 0) {
                        await releaseTicketTypeDateInventory(tx, {
                            ticketTypeId: item.ticketTypeId,
                            reservations: reservationCounts,
                        })
                    }
                }

                const decrement = await tx.ticketType.updateMany({
                    where: {
                        id: item.ticketTypeId,
                        sold: { gte: item.quantity },
                    },
                    data: {
                        sold: { decrement: item.quantity },
                    },
                })

                if (decrement.count > 0) {
                    released += item.quantity
                    keys.push(`${item.ticketType.eventId}:${item.ticketTypeId}`)
                }
            }

            return { expired: true, released, keys }
        })

        if (result.expired) {
            expiredOrders += 1
            releasedTickets += result.released
            for (const key of result.keys) {
                invalidations.add(key)
            }
        }
    }

    await Promise.all(
        Array.from(invalidations).map((entry) => {
            const [eventId, ticketTypeId] = entry.split(":")
            return onTicketSold(eventId, ticketTypeId)
        })
    )

    return {
        success: true,
        processed: pendingOrders.length,
        expiredOrders,
        releasedTickets,
        cutoffDate: cutoffDate.toISOString(),
        timestamp: new Date().toISOString(),
    }
}
