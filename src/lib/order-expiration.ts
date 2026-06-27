import { prisma } from "@/lib/prisma"
import { onTicketSold } from "@/lib/cached-queries"
import { buildPoolFreeReservationCounts, isPoolFreeEventCategory } from "@/lib/pool-free"
import { releaseTicketTypeDateInventory } from "@/lib/ticket-date-inventory"

const ORDER_EXPIRATION_MINUTES = 30
// Izipay con pago iniciado (tiene correlacion) se excluye de la ventana corta para
// no cancelar un pago en curso. Pero pasada esta ventana larga, la sesion de Izipay
// ya murio (abandono) y la orden tambien se cancela liberando el cupo. Antes estas
// quedaban PENDING para siempre (parqueadas en needs-review) reteniendo inventario.
const IZIPAY_STALE_MINUTES = (() => {
    const v = Number(process.env.ORDER_IZIPAY_EXPIRATION_MINUTES)
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 180
})()
const IZIPAY_MIN_SYNC_ATTEMPTS_BEFORE_EXPIRATION = (() => {
    const v = Number(process.env.ORDER_IZIPAY_MIN_SYNC_ATTEMPTS_BEFORE_EXPIRATION)
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 6
})()
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
        izipayMinutes?: number
        maxOrders?: number
    }
): Promise<ExpirePendingOrdersResult> {
    const expirationMinutes = options?.expirationMinutes ?? ORDER_EXPIRATION_MINUTES
    const izipayMinutes = options?.izipayMinutes ?? IZIPAY_STALE_MINUTES
    const maxOrders = options?.maxOrders ?? MAX_ORDERS_PER_RUN
    const cutoffDate = new Date(Date.now() - expirationMinutes * 60 * 1000)
    const izipayCutoffDate = new Date(Date.now() - izipayMinutes * 60 * 1000)

    const pendingOrders = await prisma.order.findMany({
        where: {
            status: "PENDING",
            OR: [
                // Orden normal (no-Izipay, o Izipay sin correlacion) mas vieja que
                // la ventana corta -> expira como siempre.
                {
                    createdAt: { lte: cutoffDate },
                    OR: [
                        { provider: { not: "IZIPAY" } },
                        { providerOrderNumber: null },
                        { providerTransactionId: null },
                    ],
                },
                // Izipay con pago iniciado pero abandonado: antes de cancelar debe
                // haber pasado por varias conciliaciones. Si llega a revision
                // manual, no se autocancela: ahi es mas seguro cruzar Izipay/CSV que
                // convertir un cobro tardio en CANCELLED-sin-entrada.
                {
                    provider: "IZIPAY",
                    createdAt: { lte: izipayCutoffDate },
                    paymentNeedsReview: false,
                    paymentSyncAttempts: {
                        gte: IZIPAY_MIN_SYNC_ATTEMPTS_BEFORE_EXPIRATION,
                    },
                },
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
                    merchVariantId: true,
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
                // Branch MERCH: libera la reserva en merch_variants
                if (item.merchVariantId) {
                    await tx.$queryRaw`
                        UPDATE "merch_variants"
                        SET "reserved" = GREATEST("reserved" - ${item.quantity}, 0),
                            "updatedAt" = NOW()
                        WHERE "id" = ${item.merchVariantId}
                    `
                    released += item.quantity
                    continue
                }

                if (!item.ticketType || !item.ticketTypeId) continue
                const ticketType = item.ticketType
                const ticketTypeId = item.ticketTypeId
                if (isPoolFreeEventCategory(ticketType.event.category)) {
                    const reservationCounts = buildPoolFreeReservationCounts({
                        attendees: Array.isArray(item.attendeeData) ? item.attendeeData : [],
                        quantity: item.quantity,
                        validDays: ticketType.validDays,
                        eventStartDate: ticketType.event.startDate,
                        eventEndDate: ticketType.event.endDate,
                        ticketLabel: ticketType.name,
                        strict: false,
                    })

                    if (reservationCounts.size > 0) {
                        await releaseTicketTypeDateInventory(tx, {
                            ticketTypeId,
                            reservations: reservationCounts,
                        })
                    }
                }

                const decrement = await tx.ticketType.updateMany({
                    where: {
                        id: ticketTypeId,
                        sold: { gte: item.quantity },
                    },
                    data: {
                        sold: { decrement: item.quantity },
                    },
                })

                if (decrement.count > 0) {
                    released += item.quantity
                    keys.push(`${ticketType.eventId}:${ticketTypeId}`)
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
