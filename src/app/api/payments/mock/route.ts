import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { mockIzipayPayment } from "@/lib/izipay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const paymentsMode = process.env.PAYMENTS_MODE || "mock"

        if (paymentsMode !== "mock") {
            return NextResponse.json(
                { success: false, error: "Ruta no disponible" },
                { status: 404 }
            )
        }

        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const { orderId } = body

        if (!orderId) {
            return NextResponse.json(
                { success: false, error: "Falta orderId" },
                { status: 400 }
            )
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: { id: true, userId: true, status: true },
        })

        if (!order) {
            return NextResponse.json(
                { success: false, error: "Orden no encontrada" },
                { status: 404 }
            )
        }

        if (order.userId !== user.id && !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 403 }
            )
        }

        if (order.status === "PAID") {
            return NextResponse.json({
                success: true,
                data: {
                    orderId: order.id,
                    status: order.status,
                },
                alreadyPaid: true,
            })
        }

        const paymentResult = await mockIzipayPayment(order.id)

        if (!paymentResult.success) {
            return NextResponse.json(
                { success: false, error: "Error al procesar el pago" },
                { status: 500 }
            )
        }

        const fulfillResult = await fulfillPaidOrder({
            orderId: order.id,
            providerRef: paymentResult.transactionId,
            providerResponse: {
                mock: true,
                transactionId: paymentResult.transactionId,
            },
        })

        if (!fulfillResult.success) {
            return NextResponse.json(
                { success: false, error: fulfillResult.error || "Error al confirmar la orden" },
                { status: 500 }
            )
        }

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.id,
                status: "PAID",
                transactionId: paymentResult.transactionId,
            },
        })
    } catch (error) {
        console.error("Mock payment error:", error)
        return NextResponse.json(
            { success: false, error: "Error al procesar pago" },
            { status: 500 }
        )
    }
}

