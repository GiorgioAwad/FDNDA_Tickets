import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { verifyIzipayWebhookSignature, IzipayWebhookPayload } from "@/lib/izipay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import { acquireLock, releaseLock } from "@/lib/cache"
import { onTicketSold } from "@/lib/cached-queries"

export const runtime = "nodejs"

const WEBHOOK_LOCK_TTL_SECONDS = 30

export async function POST(request: NextRequest) {
    const body = await request.json() as IzipayWebhookPayload
    const lockKey = `webhook:order:${body.orderDetails.orderId}`
    let lockAcquired = false

    try {
        lockAcquired = await acquireLock(lockKey, WEBHOOK_LOCK_TTL_SECONDS)

        // Si otro worker ya esta procesando, responder 200 para evitar reintentos ruidosos.
        if (!lockAcquired) {
            return NextResponse.json({ success: true, processing: true })
        }

        const isValid = verifyIzipayWebhookSignature(body, body.hash)
        if (!isValid) {
            console.error("Invalid IZIPAY webhook signature")
            return NextResponse.json(
                { success: false, error: "Invalid signature" },
                { status: 401 }
            )
        }

        const { orderDetails, transactionDetails, orderStatus } = body

        const order = await prisma.order.findUnique({
            where: { id: orderDetails.orderId },
            select: {
                id: true,
                status: true,
                _count: {
                    select: { tickets: true },
                },
            },
        })

        if (!order) {
            console.error("Order not found:", orderDetails.orderId)
            return NextResponse.json(
                { success: false, error: "Order not found" },
                { status: 404 }
            )
        }

        if (orderStatus === "PAID") {
            const transition = await prisma.order.updateMany({
                where: {
                    id: order.id,
                    status: "PENDING",
                },
                data: {
                    status: "PAID",
                    paidAt: new Date(),
                    providerRef: transactionDetails.transactionId,
                    providerResponse: body as unknown as Prisma.InputJsonValue,
                },
            })

            if (transition.count === 0) {
                const current = await prisma.order.findUnique({
                    where: { id: order.id },
                    select: {
                        status: true,
                        _count: {
                            select: { tickets: true },
                        },
                    },
                })

                if (!current) {
                    return NextResponse.json({ success: true })
                }

                if (current.status !== "PAID") {
                    // CANCELLED/REFUNDED u otro estado terminal: ignorar webhook duplicado.
                    return NextResponse.json({ success: true, ignored: true })
                }

                if (current._count.tickets > 0) {
                    return NextResponse.json({ success: true, alreadyProcessed: true })
                }
            }

            // Si quedo en PAID sin tickets (por corte previo), esto reintenta el fulfillment.
            const result = await fulfillPaidOrder({
                orderId: order.id,
                providerRef: transactionDetails.transactionId,
                providerResponse: body as unknown as Prisma.InputJsonValue,
            })

            if (!result.success) {
                console.error("Failed to fulfill order:", result.error)
                return NextResponse.json(
                    { success: false, error: result.error || "Failed to fulfill order" },
                    { status: 500 }
                )
            }
        } else if (orderStatus === "CANCELLED" || orderStatus === "ERROR") {
            const cancellationResult = await prisma.$transaction(async (tx) => {
                const cancelled = await tx.order.updateMany({
                    where: {
                        id: order.id,
                        status: "PENDING",
                    },
                    data: {
                        status: "CANCELLED",
                        providerResponse: body as unknown as Prisma.InputJsonValue,
                    },
                })

                if (cancelled.count === 0) {
                    return { cancelled: false, invalidations: [] as Array<{ eventId: string; ticketTypeId: string }> }
                }

                const orderItems = await tx.orderItem.findMany({
                    where: { orderId: order.id },
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

                const invalidations = orderItems.map((item) => ({
                    eventId: item.ticketType.eventId,
                    ticketTypeId: item.ticketTypeId,
                }))

                return { cancelled: true, invalidations }
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
    } catch (error) {
        console.error("Webhook error:", error)
        return NextResponse.json(
            { success: false, error: "Webhook processing failed" },
            { status: 500 }
        )
    } finally {
        if (lockAcquired) {
            await releaseLock(lockKey)
        }
    }
}
