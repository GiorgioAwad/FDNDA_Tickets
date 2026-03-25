import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { createOpenPayCharge, getChargeDueDate } from "@/lib/openpay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"

export const runtime = "nodejs"

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
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
                orderItems: {
                    take: 1,
                    select: {
                        ticketType: {
                            select: {
                                event: {
                                    select: {
                                        title: true,
                                    },
                                },
                            },
                        },
                    },
                },
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

        if (order.status === "PAID") {
            return NextResponse.json({
                success: true,
                data: {
                    orderId: order.id,
                    alreadyPaid: true,
                },
            })
        }

        if (order.status !== "PENDING") {
            return NextResponse.json(
                { success: false, error: "La orden no esta disponible para pago" },
                { status: 400 }
            )
        }

        const totalAmount = Number(order.totalAmount)
        if (!Number.isFinite(totalAmount) || totalAmount < 0) {
            return NextResponse.json(
                { success: false, error: "Monto de orden invalido" },
                { status: 400 }
            )
        }

        // Zero-amount orders (100% discount) - fulfill without payment gateway
        if (totalAmount === 0) {
            const result = await fulfillPaidOrder({
                orderId: order.id,
                providerRef: `FREE-${order.id}`,
                providerResponse: { autoApproved: true, reason: "zero_amount" },
            })

            if (!result.success) {
                return NextResponse.json(
                    { success: false, error: result.error || "No se pudo confirmar la orden" },
                    { status: 500 }
                )
            }

            return NextResponse.json({
                success: true,
                data: {
                    orderId: order.id,
                    alreadyPaid: true,
                    zeroAmount: true,
                },
            })
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
        const eventTitle = order.orderItems[0]?.ticketType.event.title || "Evento FDNDA"

        // OpenPay amount is in PEN decimal (NOT cents)
        const chargeResult = await createOpenPayCharge({
            orderId: order.id,
            amount: totalAmount,
            currency: order.currency,
            description: `${eventTitle} - Orden ${order.id.slice(-8).toUpperCase()}`,
            customerName: order.user.name,
            customerEmail: order.user.email,
            redirectUrl: `${appUrl}/checkout/success?orderId=${order.id}`,
            dueDate: getChargeDueDate(),
        })

        if (!chargeResult.success) {
            return NextResponse.json(
                { success: false, error: chargeResult.error || "No se pudo iniciar el pago con OpenPay" },
                { status: 502 }
            )
        }

        // Store the OpenPay charge ID for later reference
        await prisma.order.update({
            where: { id: order.id },
            data: { providerRef: chargeResult.chargeId },
        })

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.id,
                paymentUrl: chargeResult.paymentUrl,
            },
        })
    } catch (error) {
        console.error("OpenPay charge error:", error)
        return NextResponse.json(
            { success: false, error: "Error al iniciar pago con OpenPay" },
            { status: 500 }
        )
    }
}
