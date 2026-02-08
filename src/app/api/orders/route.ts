import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { createOrderSchema } from "@/lib/validations"
import { onTicketSold } from "@/lib/cached-queries"
import { z } from "zod"

export const runtime = "nodejs"

const orderRequestSchema = createOrderSchema.extend({
    discountCodeId: z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        // Rate limiting para pagos: 10 intentos por minuto por usuario
        const { success: rateLimitOk } = await rateLimit(`payment:${user.id}`, "payment")
        if (!rateLimitOk) {
            return NextResponse.json(
                { success: false, error: "Demasiados intentos. Espera un momento." },
                { status: 429 }
            )
        }

        const rawBody = await request.json()
        const parsedBody = orderRequestSchema.safeParse(rawBody)

        if (!parsedBody.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: parsedBody.error.issues[0]?.message || "Datos de orden invalidos",
                },
                { status: 400 }
            )
        }

        const { eventId, items, discountCodeId } = parsedBody.data
        const cacheInvalidations = new Set<string>()

        // Transaccion con reserva atomica de stock para evitar sobreventa.
        const order = await prisma.$transaction(async (tx) => {
            let totalAmount = 0
            let discountAmount = 0
            let validatedDiscountCode: {
                id: string
                minPurchase: Prisma.Decimal | null
                value: Prisma.Decimal
                type: "PERCENTAGE" | "FIXED"
            } | null = null
            const orderItemsData: Prisma.OrderItemUncheckedCreateWithoutOrderInput[] = []

            if (discountCodeId) {
                const discountCode = await tx.discountCode.findUnique({
                    where: { id: discountCodeId },
                    include: { _count: { select: { usages: true } } },
                })

                if (!discountCode || !discountCode.isActive) {
                    throw new Error("Codigo de descuento no valido")
                }

                const now = new Date()
                if (discountCode.validFrom && now < discountCode.validFrom) {
                    throw new Error("Codigo de descuento aun no vigente")
                }
                if (discountCode.validUntil && now > discountCode.validUntil) {
                    throw new Error("Codigo de descuento expirado")
                }
                if (discountCode.maxUses && discountCode._count.usages >= discountCode.maxUses) {
                    throw new Error("Codigo de descuento agotado")
                }
                if (discountCode.eventId && discountCode.eventId !== eventId) {
                    throw new Error("Codigo de descuento no valido para este evento")
                }

                if (discountCode.maxUsesPerUser) {
                    const userUsages = await tx.discountUsage.count({
                        where: { discountCodeId, userId: user.id },
                    })
                    if (userUsages >= discountCode.maxUsesPerUser) {
                        throw new Error("Ya usaste este codigo el maximo permitido")
                    }
                }

                validatedDiscountCode = {
                    id: discountCode.id,
                    minPurchase: discountCode.minPurchase,
                    value: discountCode.value,
                    type: discountCode.type,
                }
            }

            for (const item of items) {
                if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
                    throw new Error("La cantidad debe ser un entero mayor que cero")
                }

                const reservedRows = await tx.$queryRaw<
                    Array<{
                        id: string
                        name: string
                        price: Prisma.Decimal
                        eventId: string
                    }>
                >(Prisma.sql`
                    UPDATE "ticket_types"
                    SET "sold" = "sold" + ${item.quantity}
                    WHERE "id" = ${item.ticketTypeId}
                      AND "eventId" = ${eventId}
                      AND "isActive" = true
                      AND ("capacity" = 0 OR "sold" + ${item.quantity} <= "capacity")
                    RETURNING "id", "name", "price", "eventId"
                `)

                const reservedTicketType = reservedRows[0]

                if (!reservedTicketType) {
                    const ticketType = await tx.ticketType.findUnique({
                        where: { id: item.ticketTypeId },
                        select: {
                            id: true,
                            name: true,
                            eventId: true,
                            isActive: true,
                            capacity: true,
                            sold: true,
                        },
                    })

                    if (!ticketType) {
                        throw new Error(`Tipo de entrada no encontrado: ${item.ticketTypeId}`)
                    }

                    if (ticketType.eventId !== eventId) {
                        throw new Error(`El tipo de entrada "${ticketType.name}" no pertenece a este evento`)
                    }

                    if (!ticketType.isActive) {
                        throw new Error(`El tipo de entrada "${ticketType.name}" no esta disponible`)
                    }

                    throw new Error(
                        `El tipo de entrada "${ticketType.name}" esta agotado`
                    )
                }

                const subtotal = Number(reservedTicketType.price) * item.quantity
                totalAmount += subtotal

                orderItemsData.push({
                    ticketTypeId: item.ticketTypeId,
                    quantity: item.quantity,
                    unitPrice: reservedTicketType.price,
                    subtotal,
                    attendeeData: (item.attendees || []) as Prisma.InputJsonValue,
                })

                cacheInvalidations.add(`${eventId}:${item.ticketTypeId}`)
            }

            if (validatedDiscountCode) {
                const minPurchase = validatedDiscountCode.minPurchase
                    ? Number(validatedDiscountCode.minPurchase)
                    : 0
                const discountValue = Number(validatedDiscountCode.value)

                if (minPurchase > 0 && totalAmount < minPurchase) {
                    throw new Error(`Compra minima requerida: S/ ${minPurchase.toFixed(2)}`)
                }

                if (validatedDiscountCode.type === "PERCENTAGE") {
                    discountAmount = (totalAmount * discountValue) / 100
                } else {
                    discountAmount = Math.min(discountValue, totalAmount)
                }
            }

            const finalAmount = Math.max(0, totalAmount - discountAmount)

            const newOrder = await tx.order.create({
                data: {
                    userId: user.id,
                    status: "PENDING",
                    totalAmount: finalAmount,
                    currency: "PEN",
                    provider: "IZIPAY",
                    orderItems: {
                        create: orderItemsData,
                    },
                },
                include: {
                    orderItems: true,
                },
            })

            if (validatedDiscountCode) {
                await tx.discountUsage.create({
                    data: {
                        discountCodeId: validatedDiscountCode.id,
                        userId: user.id,
                        orderId: newOrder.id,
                        amountSaved: discountAmount,
                    },
                })
            }

            return { order: newOrder, discountAmount }
        }, {
            timeout: 10000,
        })

        await Promise.all(
            Array.from(cacheInvalidations).map((entry) => {
                const [cacheEventId, cacheTicketTypeId] = entry.split(":")
                return onTicketSold(cacheEventId, cacheTicketTypeId)
            })
        )

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.order.id,
                totalAmount: order.order.totalAmount,
                discountAmount: order.discountAmount,
                currency: order.order.currency,
            },
        })
    } catch (error) {
        console.error("Error creating order:", error)
        const message = (error as Error).message || "Error al crear orden"
        const isValidationError =
            message.includes("no valido") ||
            message.includes("invalid") ||
            message.includes("agotad") ||
            message.includes("disponible") ||
            message.includes("minima") ||
            message.includes("maximo") ||
            message.includes("entero") ||
            message.includes("pertenece")

        return NextResponse.json(
            { success: false, error: message },
            { status: isValidationError ? 400 : 500 }
        )
    }
}
