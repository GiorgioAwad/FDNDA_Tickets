import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import { onTicketSold } from "@/lib/cached-queries"
import { buildPoolFreeReservationCounts, isPoolFreeEventCategory } from "@/lib/pool-free"
import { releaseTicketTypeDateInventory } from "@/lib/ticket-date-inventory"

type IzipayStoredSource = "db" | "ipn" | "query"

export function buildIzipayProviderResponse(
    source: "webhook" | "validate" | "redirect" | "query" | "session" | "embedded",
    data: Prisma.InputJsonValue
): Prisma.InputJsonValue {
    return {
        source,
        receivedAt: new Date().toISOString(),
        data,
    }
}

export function getIzipayStoredSource(
    providerResponse: Prisma.JsonValue | null | undefined
): IzipayStoredSource {
    if (
        providerResponse &&
        typeof providerResponse === "object" &&
        !Array.isArray(providerResponse)
    ) {
        const source = (providerResponse as Record<string, unknown>).source

        if (source === "query") {
            return "query"
        }

        if (source === "webhook" || source === "embedded") {
            return "ipn"
        }
    }

    return "db"
}

export async function resolveIzipayOrderId(orderReference: string): Promise<string | null> {
    if (!orderReference) {
        return null
    }

    const exact = await prisma.order.findUnique({
        where: { id: orderReference },
        select: { id: true },
    })

    if (exact) {
        return exact.id
    }

    const byProviderOrderNumber = await prisma.order.findFirst({
        where: { providerOrderNumber: orderReference },
        select: { id: true },
    })

    if (byProviderOrderNumber) {
        return byProviderOrderNumber.id
    }

    const matches = await prisma.order.findMany({
        where: {
            id: {
                endsWith: orderReference,
            },
        },
        select: { id: true },
        take: 2,
    })

    if (matches.length === 1) {
        return matches[0].id
    }

    return null
}

export async function storeIzipayOrderCorrelation(input: {
    orderId: string
    providerOrderNumber: string
    providerTransactionId: string
}) {
    return prisma.order.update({
        where: { id: input.orderId },
        data: {
            providerOrderNumber: input.providerOrderNumber,
            providerTransactionId: input.providerTransactionId,
            paymentSyncAttempts: 0,
            paymentLastSyncAt: null,
            paymentNeedsReview: false,
        },
        select: { id: true },
    })
}

export async function fulfillIzipayOrder(input: {
    orderId: string
    providerRef?: string
    providerResponse: Prisma.InputJsonValue
    providerOrderNumber?: string
    providerTransactionId?: string
}) {
    return fulfillPaidOrder({
        orderId: input.orderId,
        providerRef: input.providerRef,
        providerResponse: input.providerResponse,
        providerOrderNumber: input.providerOrderNumber,
        providerTransactionId: input.providerTransactionId,
    })
}

export async function cancelIzipayOrder(input: {
    orderId: string
    providerResponse: Prisma.InputJsonValue
    providerOrderNumber?: string
    providerTransactionId?: string
}) {
    const cancellationResult = await prisma.$transaction(async (tx) => {
        const cancelled = await tx.order.updateMany({
            where: {
                id: input.orderId,
                status: "PENDING",
            },
            data: {
                status: "CANCELLED",
                providerResponse: input.providerResponse,
                providerOrderNumber: input.providerOrderNumber,
                providerTransactionId: input.providerTransactionId,
            },
        })

        if (cancelled.count === 0) {
            return {
                cancelled: false,
                invalidations: [] as Array<{ eventId: string; ticketTypeId: string }>,
            }
        }

        const orderItems = await tx.orderItem.findMany({
            where: { orderId: input.orderId },
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

            await tx.ticketType.updateMany({
                where: {
                    id: item.ticketTypeId,
                    sold: { gte: item.quantity },
                },
                data: {
                    sold: { decrement: item.quantity },
                },
            })
        }

        return {
            cancelled: true,
            invalidations: orderItems.map((item) => ({
                eventId: item.ticketType.eventId,
                ticketTypeId: item.ticketTypeId,
            })),
        }
    })

    if (cancellationResult.cancelled) {
        await Promise.all(
            cancellationResult.invalidations.map((item) =>
                onTicketSold(item.eventId, item.ticketTypeId)
            )
        )
    }

    return cancellationResult
}
