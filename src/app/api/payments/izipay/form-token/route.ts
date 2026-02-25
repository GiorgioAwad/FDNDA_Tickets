import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { createIzipayFormToken, getIzipayMode } from "@/lib/izipay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const paymentsMode = process.env.PAYMENTS_MODE || "mock"
        if (paymentsMode !== "izipay" || getIzipayMode() !== "embedded") {
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
                data: { orderId: order.id, alreadyPaid: true },
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

        // When total is 0 (100% discount), confirm without payment gateway.
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
                data: { orderId: order.id, alreadyPaid: true, zeroAmount: true },
            })
        }

        const amountInCents = Math.round(totalAmount * 100)
        if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
            return NextResponse.json(
                { success: false, error: "Monto de pago invalido" },
                { status: 400 }
            )
        }

        // Split name into firstName/lastName for Izipay's API
        const nameParts = order.user.name.trim().split(/\s+/)
        const firstName = nameParts[0] || order.user.name
        const lastName = nameParts.slice(1).join(" ") || firstName

        const result = await createIzipayFormToken({
            orderId: order.id,
            amount: amountInCents,
            currency: order.currency,
            customerEmail: order.user.email,
            customerFirstName: firstName,
            customerLastName: lastName,
        })

        if (!result.success || !result.formToken) {
            return NextResponse.json(
                { success: false, error: result.error || "No se pudo generar el formToken" },
                { status: 502 }
            )
        }

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.id,
                formToken: result.formToken,
                publicKey: process.env.NEXT_PUBLIC_IZIPAY_PUBLIC_KEY || "",
            },
        })
    } catch (error) {
        console.error("Izipay form-token error:", error)
        return NextResponse.json(
            { success: false, error: "Error al generar token de pago" },
            { status: 500 }
        )
    }
}
