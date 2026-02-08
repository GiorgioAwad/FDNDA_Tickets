import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { createIzipaySession } from "@/lib/izipay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const paymentsMode = process.env.PAYMENTS_MODE || "mock"
        if (paymentsMode !== "izipay") {
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

        // Cuando el total llega a 0 (descuento 100%), confirmar sin pasarela.
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

        const amountInCents = Math.round(totalAmount * 100)
        if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
            return NextResponse.json(
                { success: false, error: "Monto de pago invalido" },
                { status: 400 }
            )
        }

        const eventTitle = order.orderItems[0]?.ticketType.event.title || "Evento FDNDA"
        const session = await createIzipaySession({
            orderId: order.id,
            amount: amountInCents,
            currency: order.currency,
            customerEmail: order.user.email,
            customerName: order.user.name,
            description: `${eventTitle} - Orden ${order.id.slice(-8).toUpperCase()}`,
        })

        if (!session.success) {
            return NextResponse.json(
                { success: false, error: session.error || "No se pudo iniciar la sesion de pago" },
                { status: 502 }
            )
        }

        if (!session.paymentUrl && !session.formToken && !session.sessionToken) {
            return NextResponse.json(
                {
                    success: false,
                    error: "IziPay no devolvio datos suficientes para iniciar el pago",
                },
                { status: 502 }
            )
        }

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.id,
                paymentUrl: session.paymentUrl || null,
                sessionToken: session.sessionToken || null,
                formToken: session.formToken || null,
                checkoutUrl: process.env.IZIPAY_CHECKOUT_URL || null,
            },
        })
    } catch (error) {
        console.error("IziPay session error:", error)
        return NextResponse.json(
            { success: false, error: "Error al iniciar pago con IziPay" },
            { status: 500 }
        )
    }
}
