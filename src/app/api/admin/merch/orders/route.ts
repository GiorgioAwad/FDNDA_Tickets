import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

const ALLOWED_FULFILLMENT = ["PENDING", "READY", "SHIPPED", "DELIVERED", "PICKED_UP", "CANCELLED"] as const
const ALLOWED_DELIVERY = ["PICKUP_EVENT", "SHIPPING_HOME", "PICKUP_OFFICE"] as const
const ALLOWED_PAYMENT_STATUS = ["PENDING", "PAID", "CANCELLED", "REFUNDED"] as const

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50

export async function GET(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const url = request.nextUrl
    const fulfillmentParam = url.searchParams.get("fulfillment")
    const deliveryParam = url.searchParams.get("delivery")
    const paymentStatusParam = url.searchParams.get("paymentStatus")
    const searchParam = url.searchParams.get("q")?.trim() || ""
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, Math.floor(limitParam)), MAX_LIMIT) : DEFAULT_LIMIT

    const where: Prisma.OrderWhereInput = {
        orderType: "MERCH",
    }

    if (fulfillmentParam && (ALLOWED_FULFILLMENT as readonly string[]).includes(fulfillmentParam)) {
        where.fulfillmentStatus = fulfillmentParam as Prisma.EnumFulfillmentStatusNullableFilter["equals"]
    }

    if (deliveryParam && (ALLOWED_DELIVERY as readonly string[]).includes(deliveryParam)) {
        where.deliveryMethod = deliveryParam as Prisma.EnumDeliveryMethodNullableFilter["equals"]
    }

    if (paymentStatusParam && (ALLOWED_PAYMENT_STATUS as readonly string[]).includes(paymentStatusParam)) {
        where.status = paymentStatusParam as Prisma.EnumOrderStatusFilter["equals"]
    } else {
        where.status = "PAID"
    }

    if (searchParam) {
        where.OR = [
            { id: { contains: searchParam, mode: "insensitive" } },
            { user: { email: { contains: searchParam, mode: "insensitive" } } },
            { user: { name: { contains: searchParam, mode: "insensitive" } } },
            { buyerDocNumber: { contains: searchParam, mode: "insensitive" } },
            { trackingCode: { contains: searchParam, mode: "insensitive" } },
        ]
    }

    const orders = await prisma.order.findMany({
        where,
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        take: limit,
        select: {
            id: true,
            status: true,
            totalAmount: true,
            shippingCost: true,
            deliveryMethod: true,
            shippingAddress: true,
            shippingDistrito: true,
            shippingUbigeo: true,
            shippingPhone: true,
            fulfillmentStatus: true,
            fulfilledAt: true,
            trackingCode: true,
            paidAt: true,
            createdAt: true,
            buyerName: true,
            buyerDocNumber: true,
            buyerPhone: true,
            user: { select: { id: true, name: true, email: true } },
            orderItems: {
                select: {
                    id: true,
                    quantity: true,
                    unitPrice: true,
                    merchSnapshot: true,
                    merchVariant: {
                        select: {
                            size: true,
                            sku: true,
                            product: { select: { name: true, category: true, zone: true } },
                        },
                    },
                },
            },
        },
    })

    return NextResponse.json({
        success: true,
        data: orders.map((order) => ({
            ...order,
            totalAmount: Number(order.totalAmount),
            shippingCost: order.shippingCost ? Number(order.shippingCost) : 0,
            orderItems: order.orderItems.map((item) => ({
                ...item,
                unitPrice: Number(item.unitPrice),
            })),
        })),
    })
}
