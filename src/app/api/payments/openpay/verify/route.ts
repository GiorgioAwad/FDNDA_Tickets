import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { getOpenPayCharge } from "@/lib/openpay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"

export const runtime = "nodejs"

/**
 * Fallback endpoint: check charge status directly with OpenPay.
 * Used when the redirect happens before the webhook arrives.
 */
export async function POST(request: NextRequest) {
    try {
        const paymentsMode = process.env.PAYMENTS_MODE || "mock"
        if (paymentsMode !== "openpay") {
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
        const orderId = typeof body?.orderId === "string" ? body.orderId : ""
        if (!orderId) {
            return NextResponse.json(
                { success: false, error: "Falta orderId" },
                { status: 400 }
            )
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                userId: true,
                status: true,
                providerRef: true,
                provider: true,
            },
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

        // Already paid - no need to check
        if (order.status === "PAID") {
            return NextResponse.json({
                success: true,
                data: { orderId: order.id, status: "PAID" },
            })
        }

        if (order.status !== "PENDING" || !order.providerRef) {
            return NextResponse.json({
                success: true,
                data: { orderId: order.id, status: order.status },
            })
        }

        // Query OpenPay for the charge status
        const chargeResult = await getOpenPayCharge(order.providerRef)

        if (!chargeResult.success) {
            return NextResponse.json({
                success: true,
                data: { orderId: order.id, status: "PENDING" },
            })
        }

        // If OpenPay says completed, fulfill the order
        if (chargeResult.status === "completed") {
            const result = await fulfillPaidOrder({
                orderId: order.id,
                providerRef: chargeResult.transactionId || order.providerRef,
                providerResponse: chargeResult.raw as Prisma.InputJsonValue,
            })

            return NextResponse.json({
                success: true,
                data: {
                    orderId: order.id,
                    status: result.success ? "PAID" : "PENDING",
                },
            })
        }

        return NextResponse.json({
            success: true,
            data: { orderId: order.id, status: "PENDING" },
        })
    } catch (error) {
        console.error("OpenPay verify error:", error)
        return NextResponse.json(
            { success: false, error: "Error al verificar pago" },
            { status: 500 }
        )
    }
}
