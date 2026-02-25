import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
    verifyEmbeddedFormHash,
    parseEmbeddedAnswer,
    getIzipayMode,
} from "@/lib/izipay"
import { fulfillPaidOrder } from "@/lib/order-fulfillment"
import { acquireLock, releaseLock } from "@/lib/cache"
import { onTicketSold } from "@/lib/cached-queries"

export const runtime = "nodejs"

const LOCK_TTL_SECONDS = 30

export async function POST(request: NextRequest) {
    try {
        if (getIzipayMode() !== "embedded") {
            return NextResponse.json(
                { success: false, error: "Ruta no disponible" },
                { status: 404 }
            )
        }

        const body = await request.json()
        const krAnswer = typeof body?.["kr-answer"] === "string" ? body["kr-answer"] : ""
        const krHash = typeof body?.["kr-hash"] === "string" ? body["kr-hash"] : ""

        if (!krAnswer || !krHash) {
            return NextResponse.json(
                { success: false, error: "Datos de pago incompletos" },
                { status: 400 }
            )
        }

        const isValid = verifyEmbeddedFormHash(krAnswer, krHash)
        if (!isValid) {
            console.error("Invalid embedded form hash")
            return NextResponse.json(
                { success: false, error: "Firma de pago invalida" },
                { status: 401 }
            )
        }

        const paymentResult = parseEmbeddedAnswer(krAnswer)
        if (!paymentResult || !paymentResult.orderId) {
            return NextResponse.json(
                { success: false, error: "No se pudo interpretar la respuesta de pago" },
                { status: 400 }
            )
        }

        const lockKey = `validate:order:${paymentResult.orderId}`
        let lockAcquired = false

        try {
            lockAcquired = await acquireLock(lockKey, LOCK_TTL_SECONDS)

            if (!lockAcquired) {
                return NextResponse.json({ success: true, processing: true })
            }

            if (paymentResult.status === "PAID") {
                const result = await fulfillPaidOrder({
                    orderId: paymentResult.orderId,
                    providerRef: paymentResult.transactionId,
                    providerResponse: JSON.parse(krAnswer) as Prisma.InputJsonValue,
                })

                if (!result.success) {
                    console.error("Failed to fulfill order:", result.error)
                    return NextResponse.json(
                        { success: false, error: result.error || "Error al procesar orden" },
                        { status: 500 }
                    )
                }

                return NextResponse.json({
                    success: true,
                    data: {
                        orderId: paymentResult.orderId,
                        status: "PAID",
                        paymentMethod: paymentResult.paymentMethod,
                    },
                })
            }

            if (paymentResult.status === "CANCELLED" || paymentResult.status === "ERROR") {
                const cancellationResult = await prisma.$transaction(async (tx) => {
                    const cancelled = await tx.order.updateMany({
                        where: {
                            id: paymentResult.orderId,
                            status: "PENDING",
                        },
                        data: {
                            status: "CANCELLED",
                            providerResponse: JSON.parse(krAnswer) as Prisma.InputJsonValue,
                        },
                    })

                    if (cancelled.count === 0) {
                        return { cancelled: false, invalidations: [] as Array<{ eventId: string; ticketTypeId: string }> }
                    }

                    const orderItems = await tx.orderItem.findMany({
                        where: { orderId: paymentResult.orderId },
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

                return NextResponse.json({
                    success: true,
                    data: {
                        orderId: paymentResult.orderId,
                        status: paymentResult.status,
                    },
                })
            }

            // UNPAID or unknown status
            return NextResponse.json({
                success: true,
                data: {
                    orderId: paymentResult.orderId,
                    status: paymentResult.status,
                },
            })
        } finally {
            if (lockAcquired) {
                await releaseLock(lockKey)
            }
        }
    } catch (error) {
        console.error("Izipay validate error:", error)
        return NextResponse.json(
            { success: false, error: "Error al validar pago" },
            { status: 500 }
        )
    }
}
