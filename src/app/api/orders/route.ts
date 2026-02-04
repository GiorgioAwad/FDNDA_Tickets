import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { rateLimit, getClientIP } from "@/lib/rate-limit"
export const runtime = "nodejs"

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

        const body = await request.json()
        const { eventId, items, discountCodeId } = body

        if (!eventId || !items || !Array.isArray(items) || items.length === 0) {
            return NextResponse.json(
                { success: false, error: "Datos de orden inválidos" },
                { status: 400 }
            )
        }

        // Usar transacción para evitar race conditions y sobreventa
        const order = await prisma.$transaction(async (tx) => {
            let totalAmount = 0
            let discountAmount = 0
            let validatedDiscountCode = null
            const orderItemsData = []

            // Validar código de descuento si se proporciona
            if (discountCodeId) {
                const discountCode = await tx.discountCode.findUnique({
                    where: { id: discountCodeId },
                    include: { _count: { select: { usages: true } } },
                })

                if (!discountCode || !discountCode.isActive) {
                    throw new Error("Código de descuento no válido")
                }

                const now = new Date()
                if (discountCode.validFrom && now < discountCode.validFrom) {
                    throw new Error("Código de descuento aún no vigente")
                }
                if (discountCode.validUntil && now > discountCode.validUntil) {
                    throw new Error("Código de descuento expirado")
                }
                if (discountCode.maxUses && discountCode._count.usages >= discountCode.maxUses) {
                    throw new Error("Código de descuento agotado")
                }
                if (discountCode.eventId && discountCode.eventId !== eventId) {
                    throw new Error("Código de descuento no válido para este evento")
                }

                // Verificar usos por usuario
                if (discountCode.maxUsesPerUser) {
                    const userUsages = await tx.discountUsage.count({
                        where: { discountCodeId, userId: user.id },
                    })
                    if (userUsages >= discountCode.maxUsesPerUser) {
                        throw new Error("Ya usaste este código el máximo permitido")
                    }
                }

                validatedDiscountCode = discountCode
            }

            for (const item of items) {
                // Bloqueo optimista: verificar disponibilidad dentro de la transacción
                const ticketType = await tx.ticketType.findUnique({
                    where: { id: item.ticketTypeId },
                })

                if (!ticketType) {
                    throw new Error(`Tipo de entrada no encontrado: ${item.ticketTypeId}`)
                }

                if (!ticketType.isActive) {
                    throw new Error(`El tipo de entrada "${ticketType.name}" no está disponible`)
                }

                const available = ticketType.capacity === 0 
                    ? Infinity 
                    : ticketType.capacity - ticketType.sold

                if (item.quantity > available) {
                    throw new Error(
                        `Solo quedan ${available} entradas disponibles para "${ticketType.name}"`
                    )
                }

                // Reservar inmediatamente las entradas (incrementar sold)
                await tx.ticketType.update({
                    where: { id: item.ticketTypeId },
                    data: { sold: { increment: item.quantity } },
                })

                const subtotal = Number(ticketType.price) * item.quantity
                totalAmount += subtotal

                orderItemsData.push({
                    ticketTypeId: item.ticketTypeId,
                    quantity: item.quantity,
                    unitPrice: ticketType.price,
                    subtotal,
                    attendeeData: item.attendees || [],
                })
            }

            // Aplicar descuento si hay código válido
            if (validatedDiscountCode) {
                const minPurchase = validatedDiscountCode.minPurchase ? Number(validatedDiscountCode.minPurchase) : 0
                const discountValue = Number(validatedDiscountCode.value)
                
                if (minPurchase > 0 && totalAmount < minPurchase) {
                    throw new Error(`Compra mínima requerida: S/ ${minPurchase.toFixed(2)}`)
                }

                if (validatedDiscountCode.type === "PERCENTAGE") {
                    discountAmount = (totalAmount * discountValue) / 100
                } else {
                    discountAmount = Math.min(discountValue, totalAmount)
                }
            }

            const finalAmount = Math.max(0, totalAmount - discountAmount)

            // Crear orden
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

            // Registrar uso del código de descuento
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
            // Timeout de 10 segundos para la transacción
            timeout: 10000,
        })

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
        return NextResponse.json(
            { success: false, error: (error as Error).message || "Error al crear orden" },
            { status: 500 }
        )
    }
}

