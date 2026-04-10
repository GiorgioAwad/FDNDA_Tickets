import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
    verifyOpenPayWebhook,
    mapOpenPayStatus,
    OpenPayWebhookPayload,
} from "@/lib/openpay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import { acquireLock, releaseLock } from "@/lib/cache"
import { onTicketSold } from "@/lib/cached-queries"
import { buildPoolFreeReservationCounts, isPoolFreeEventCategory } from "@/lib/pool-free"
import { releaseTicketTypeDateInventory } from "@/lib/ticket-date-inventory"

export const runtime = "nodejs"

const WEBHOOK_LOCK_TTL_SECONDS = 30

export async function POST(request: NextRequest) {
    try {
        // Verify webhook authenticity via Basic Auth (if configured)
        if (!verifyOpenPayWebhook(request)) {
            console.error("Invalid OpenPay webhook credentials")
            return NextResponse.json(
                { success: false, error: "Unauthorized" },
                { status: 401 }
            )
        }

        const body = (await request.json()) as Record<string, unknown>

        // Handle OpenPay webhook verification request.
        // When you register a webhook URL, OpenPay sends a POST with
        // { "verification_code": "..." } that you must echo back.
        if (body.verification_code) {
            console.log("OpenPay webhook verification code:", body.verification_code)
            return NextResponse.json({ verification_code: body.verification_code })
        }

        const payload = body as unknown as OpenPayWebhookPayload

        if (!payload.type || !payload.transaction) {
            console.error("Invalid OpenPay webhook payload:", body)
            return NextResponse.json(
                { success: false, error: "Invalid payload" },
                { status: 400 }
            )
        }

        const { transaction } = payload
        const orderId = transaction.order_id

        if (!orderId) {
            console.error("OpenPay webhook missing order_id:", payload)
            return NextResponse.json(
                { success: false, error: "Missing order_id" },
                { status: 400 }
            )
        }

        const status = mapOpenPayStatus(payload.type, transaction.status)

        // Ignore events that don't resolve to a final status
        if (status === "PENDING") {
            return NextResponse.json({ success: true, ignored: true })
        }

        const lockKey = `webhook:order:${orderId}`
        let lockAcquired = false

        try {
            lockAcquired = await acquireLock(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

            if (!lockAcquired) {
                return NextResponse.json({ success: true, processing: true })
            }

            const order = await prisma.order.findUnique({
                where: { id: orderId },
                select: {
                    id: true,
                    status: true,
                    _count: { select: { tickets: true } },
                },
            })

            if (!order) {
                console.error("OpenPay webhook: order not found:", orderId)
                return NextResponse.json(
                    { success: false, error: "Order not found" },
                    { status: 404 }
                )
            }

            if (status === "PAID") {
                const result = await fulfillPaidOrder({
                    orderId: order.id,
                    providerRef: transaction.id,
                    providerResponse: payload as unknown as Prisma.InputJsonValue,
                })

                if (!result.success) {
                    console.error("OpenPay webhook: failed to fulfill order:", result.error)
                    return NextResponse.json(
                        { success: false, error: result.error || "Failed to fulfill order" },
                        { status: 500 }
                    )
                }
            } else if (status === "CANCELLED") {
                const cancellationResult = await prisma.$transaction(async (tx) => {
                    const cancelled = await tx.order.updateMany({
                        where: { id: order.id, status: "PENDING" },
                        data: {
                            status: "CANCELLED",
                            providerResponse: payload as unknown as Prisma.InputJsonValue,
                        },
                    })

                    if (cancelled.count === 0) {
                        return {
                            cancelled: false,
                            invalidations: [] as Array<{ eventId: string; ticketTypeId: string }>,
                        }
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
                            where: { id: item.ticketTypeId, sold: { gte: item.quantity } },
                            data: { sold: { decrement: item.quantity } },
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
            }

            return NextResponse.json({ success: true })
        } finally {
            if (lockAcquired) {
                await releaseLock(lockKey)
            }
        }
    } catch (error) {
        console.error("OpenPay webhook error:", error)
        return NextResponse.json(
            { success: false, error: "Webhook processing failed" },
            { status: 500 }
        )
    }
}
