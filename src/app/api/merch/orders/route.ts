import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { buildBillingSnapshot } from "@/lib/billing"
import { rateLimit } from "@/lib/rate-limit"

export const runtime = "nodejs"

const SHIPPING_COST_LIMA = Number(process.env.MERCH_SHIPPING_COST_LIMA ?? "10")
const SHIPPING_COST_PROVINCE = Number(process.env.MERCH_SHIPPING_COST_PROV ?? "15")

const merchItemSchema = z.object({
    productId: z.string().min(1),
    variantId: z.string().min(1),
    quantity: z.number().int().min(1).max(10),
})

const billingSchema = z.object({
    documentType: z.enum(["BOLETA", "FACTURA"]),
    buyerDocNumber: z.string().min(1),
    buyerName: z.string().optional().nullable(),
    buyerAddress: z.string().optional().nullable(),
    buyerEmail: z.string().email().optional().nullable(),
    buyerPhone: z.string().optional().nullable(),
    buyerUbigeo: z.string().optional().nullable(),
    buyerFirstName: z.string().optional().nullable(),
    buyerSecondName: z.string().optional().nullable(),
    buyerLastNamePaternal: z.string().optional().nullable(),
    buyerLastNameMaternal: z.string().optional().nullable(),
})

const merchOrderSchema = z.object({
    items: z.array(merchItemSchema).min(1).max(20),
    billing: billingSchema,
    delivery: z.discriminatedUnion("method", [
        z.object({
            method: z.literal("PICKUP_EVENT"),
            pickupEventId: z.string().min(1),
        }),
        z.object({
            method: z.literal("SHIPPING_HOME"),
            shippingAddress: z.string().min(5),
            shippingDistrito: z.string().min(1),
            shippingUbigeo: z.string().optional().nullable(),
            shippingReference: z.string().optional().nullable(),
            shippingPhone: z.string().min(6),
        }),
        z.object({
            method: z.literal("PICKUP_OFFICE"),
        }),
    ]),
})

// Determina costo de envío según ubigeo (00 = Lima Metropolitana)
function calculateShippingCost(ubigeo: string | null | undefined): number {
    if (!ubigeo) return SHIPPING_COST_PROVINCE
    // Ubigeo INEI: primeros 2 dígitos son departamento. 15 = Lima
    return ubigeo.startsWith("15") ? SHIPPING_COST_LIMA : SHIPPING_COST_PROVINCE
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json({ success: false, error: "Debes iniciar sesión" }, { status: 401 })
        }

        const { success: rateLimitOk } = await rateLimit(`merch-order:${user.id}`, "payment")
        if (!rateLimitOk) {
            return NextResponse.json(
                { success: false, error: "Demasiados intentos. Espera un momento." },
                { status: 429 }
            )
        }

        const rawBody = await request.json()
        const parsed = merchOrderSchema.safeParse(rawBody)

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, error: parsed.error.issues[0]?.message || "Datos inválidos" },
                { status: 400 }
            )
        }

        const { items, billing, delivery } = parsed.data
        const billingSnapshot = buildBillingSnapshot(billing, user.email)

        // Resolver shipping cost antes de transacción
        let shippingCost = 0
        let pickupEventId: string | null = null
        if (delivery.method === "SHIPPING_HOME") {
            shippingCost = calculateShippingCost(delivery.shippingUbigeo)
        } else if (delivery.method === "PICKUP_EVENT") {
            const event = await prisma.event.findFirst({
                where: { id: delivery.pickupEventId, isPublished: true },
                select: { id: true },
            })
            if (!event) {
                return NextResponse.json({ success: false, error: "Evento de recojo inválido" }, { status: 400 })
            }
            pickupEventId = event.id
        }

        const order = await prisma.$transaction(async (tx) => {
            let itemsTotal = 0
            const orderItemsData: Prisma.OrderItemUncheckedCreateWithoutOrderInput[] = []

            for (const item of items) {
                const product = await tx.merchProduct.findUnique({
                    where: { id: item.productId },
                    select: {
                        id: true,
                        name: true,
                        category: true,
                        zone: true,
                        price: true,
                        imageUrl: true,
                        isActive: true,
                    },
                })

                if (!product || !product.isActive) {
                    throw new Error(`Producto no disponible: ${item.productId}`)
                }

                // Reserva atómica: incrementa "reserved" solo si hay stock libre
                const reservation = await tx.$queryRaw<Array<{ id: string; size: string | null; sku: string }>>`
                    UPDATE "merch_variants"
                    SET "reserved" = "reserved" + ${item.quantity},
                        "updatedAt" = NOW()
                    WHERE "id" = ${item.variantId}
                      AND "productId" = ${item.productId}
                      AND "isActive" = TRUE
                      AND ("stock" - "reserved" - "sold") >= ${item.quantity}
                    RETURNING "id", "size", "sku"
                `

                if (reservation.length === 0) {
                    throw new Error(`Sin stock disponible para ${product.name}`)
                }

                const variant = reservation[0]
                const unitPrice = Number(product.price)
                const subtotal = unitPrice * item.quantity
                itemsTotal += subtotal

                orderItemsData.push({
                    merchVariantId: variant.id,
                    quantity: item.quantity,
                    unitPrice: unitPrice,
                    subtotal,
                    merchSnapshot: {
                        productId: product.id,
                        productName: product.name,
                        category: product.category,
                        zone: product.zone,
                        size: variant.size,
                        sku: variant.sku,
                        imageUrl: product.imageUrl,
                    } as Prisma.InputJsonValue,
                })
            }

            const totalAmount = itemsTotal + shippingCost

            const orderDeliveryFields: Prisma.OrderUncheckedCreateInput = {
                userId: user.id,
                status: "PENDING",
                orderType: "MERCH",
                totalAmount,
                currency: "PEN",
                provider: "IZIPAY",
                fulfillmentStatus: "PENDING",
                deliveryMethod: delivery.method,
                pickupEventId,
                shippingCost: shippingCost > 0 ? shippingCost : null,
                ...(delivery.method === "SHIPPING_HOME"
                    ? {
                          shippingAddress: delivery.shippingAddress,
                          shippingDistrito: delivery.shippingDistrito,
                          shippingUbigeo: delivery.shippingUbigeo || null,
                          shippingReference: delivery.shippingReference || null,
                          shippingPhone: delivery.shippingPhone,
                      }
                    : {}),
                ...billingSnapshot,
                orderItems: { create: orderItemsData },
            }

            return tx.order.create({
                data: orderDeliveryFields,
                include: { orderItems: true },
            })
        })

        return NextResponse.json({
            success: true,
            data: {
                orderId: order.id,
                totalAmount: Number(order.totalAmount),
                shippingCost: order.shippingCost ? Number(order.shippingCost) : 0,
            },
        })
    } catch (error) {
        console.error("Error creando orden merch:", error)
        const message = error instanceof Error ? error.message : "Error al crear orden"
        return NextResponse.json({ success: false, error: message }, { status: 400 })
    }
}
