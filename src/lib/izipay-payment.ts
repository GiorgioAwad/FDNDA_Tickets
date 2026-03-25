import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import { onTicketSold } from "@/lib/cached-queries"

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

export async function fulfillIzipayOrder(input: {
    orderId: string
    providerRef?: string
    providerResponse: Prisma.InputJsonValue
}) {
    return fulfillPaidOrder({
        orderId: input.orderId,
        providerRef: input.providerRef,
        providerResponse: input.providerResponse,
    })
}

export async function cancelIzipayOrder(input: {
    orderId: string
    providerResponse: Prisma.InputJsonValue
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
                ticketType: {
                    select: { eventId: true },
                },
            },
        })

        for (const item of orderItems) {
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
