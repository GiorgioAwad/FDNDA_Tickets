import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { verifyIzipayWebhookSignature, IzipayWebhookPayload } from "@/lib/izipay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import type { Prisma } from "@prisma/client"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as IzipayWebhookPayload

        // Verify webhook signature
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
            select: { id: true, status: true },
        })

        if (!order) {
            console.error("Order not found:", orderDetails.orderId)
            return NextResponse.json(
                { success: false, error: "Order not found" },
                { status: 404 }
            )
        }

        // Handle payment status
        if (orderStatus === "PAID") {
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
            if (order.status !== "PAID") {
                await prisma.order.update({
                    where: { id: order.id },
                    data: {
                        status: "CANCELLED",
                        providerResponse: body as unknown as Prisma.InputJsonValue,
                    },
                })
            }
        }

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Webhook error:", error)
        return NextResponse.json(
            { success: false, error: "Webhook processing failed" },
            { status: 500 }
        )
    }
}

