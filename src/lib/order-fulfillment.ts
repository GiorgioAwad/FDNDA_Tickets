import { prisma } from "@/lib/prisma"
import { generateTicketCode, getDaysBetween, formatPrice } from "@/lib/utils"
import { sendPurchaseConfirmationEmail, sendPurchaseEmail } from "@/lib/email"
import { onTicketSold } from "@/lib/cached-queries"
import type { Prisma } from "@prisma/client"

export interface FulfillOrderResult {
    success: boolean
    alreadyPaid?: boolean
    error?: string
}

interface FulfillOrderInput {
    orderId: string
    providerRef?: string
    providerResponse?: Prisma.InputJsonValue
}

export async function fulfillPaidOrder({
    orderId,
    providerRef,
    providerResponse,
}: FulfillOrderInput): Promise<FulfillOrderResult> {
    const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
            user: true,
            tickets: { select: { id: true } },
            orderItems: {
                include: {
                    ticketType: {
                        include: {
                            event: true,
                        },
                    },
                },
            },
        },
    })

    if (!order) {
        return { success: false, error: "Order not found" }
    }

    if (order.orderItems.length === 0) {
        return { success: false, error: "Order has no items" }
    }

    const hasTickets = order.tickets.length > 0
    const alreadyPaid = order.status === "PAID" && hasTickets

    if (alreadyPaid) {
        return { success: true, alreadyPaid: true }
    }

    if (order.status === "CANCELLED" || order.status === "REFUNDED") {
        return { success: false, error: "Order not payable" }
    }

    const updateData: Prisma.OrderUpdateInput = {
        status: "PAID",
    }

    if (!order.paidAt) {
        updateData.paidAt = new Date()
    }

    if (providerRef) {
        updateData.providerRef = providerRef
    }

    if (providerResponse) {
        updateData.providerResponse = providerResponse
    }

    await prisma.$transaction(async (tx) => {
        await tx.order.update({
            where: { id: order.id },
            data: updateData,
        })

        if (!hasTickets) {
            for (const item of order.orderItems) {
                const event = item.ticketType.event
                const attendeeData = Array.isArray(item.attendeeData)
                    ? (item.attendeeData as { name: string; dni: string }[])
                    : []

                let validDays: Date[] = []

                if (item.ticketType.isPackage && item.ticketType.packageDaysCount) {
                    const allDays = getDaysBetween(event.startDate, event.endDate)
                    validDays = allDays.slice(0, item.ticketType.packageDaysCount)
                } else if (item.ticketType.validDays) {
                    validDays = (item.ticketType.validDays as string[]).map((d) => new Date(d))
                } else {
                    validDays = getDaysBetween(event.startDate, event.endDate)
                }

                for (let i = 0; i < item.quantity; i++) {
                    const attendee = attendeeData[i] || { name: null, dni: null }
                    const ticketCode = generateTicketCode()

                    await tx.ticket.create({
                        data: {
                            orderId: order.id,
                            userId: order.userId,
                            eventId: event.id,
                            ticketTypeId: item.ticketTypeId,
                            ticketCode,
                            attendeeName: attendee.name || order.user.name,
                            attendeeDni: attendee.dni || null,
                            status: "ACTIVE",
                            entitlements: {
                                create: validDays.map((date) => ({
                                    date,
                                    status: "AVAILABLE",
                                })),
                            },
                        },
                    })
                }

                await tx.ticketType.update({
                    where: { id: item.ticketTypeId },
                    data: {
                        sold: { increment: item.quantity },
                    },
                })

                // Invalidar cache de stock
                await onTicketSold(item.ticketType.eventId, item.ticketTypeId)
            }
        }
    })

    if (!hasTickets) {
        const eventTitle = order.orderItems[0]?.ticketType.event.title || "Evento FDNDA"
        const eventId = order.orderItems[0]?.ticketType.eventId
        const ticketCount = order.orderItems.reduce(
            (sum: number, item: { quantity: number }) => sum + item.quantity,
            0
        )

        // Usar email con cola (más resiliente)
        await sendPurchaseEmail(
            order.user.email,
            order.user.name,
            order.id,
            eventTitle,
            ticketCount,
            formatPrice(Number(order.totalAmount))
        )

        // Invalidar cache de evento si no se hizo en el loop
        if (eventId) {
            await onTicketSold(eventId, order.orderItems[0].ticketTypeId)
        }
    }

    return { success: true }
}
