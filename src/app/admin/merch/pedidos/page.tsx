import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import AdminMerchOrdersClient, { type AdminMerchOrder } from "./AdminMerchOrdersClient"

export const dynamic = "force-dynamic"

async function getInitialOrders(): Promise<AdminMerchOrder[]> {
    const orders = await prisma.order.findMany({
        where: { orderType: "MERCH", status: "PAID" },
        orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
        take: 50,
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

    return orders.map((order) => ({
        id: order.id,
        status: order.status,
        totalAmount: Number(order.totalAmount),
        shippingCost: order.shippingCost ? Number(order.shippingCost) : 0,
        deliveryMethod: order.deliveryMethod,
        shippingAddress: order.shippingAddress,
        shippingDistrito: order.shippingDistrito,
        shippingUbigeo: order.shippingUbigeo,
        shippingPhone: order.shippingPhone,
        fulfillmentStatus: order.fulfillmentStatus,
        fulfilledAt: order.fulfilledAt ? order.fulfilledAt.toISOString() : null,
        trackingCode: order.trackingCode,
        paidAt: order.paidAt ? order.paidAt.toISOString() : null,
        createdAt: order.createdAt.toISOString(),
        buyerName: order.buyerName,
        buyerDocNumber: order.buyerDocNumber,
        buyerPhone: order.buyerPhone,
        user: order.user,
        orderItems: order.orderItems.map((item) => ({
            id: item.id,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
            merchSnapshot: item.merchSnapshot as Record<string, unknown> | null,
            merchVariant: item.merchVariant,
        })),
    }))
}

export default async function AdminMerchOrdersPage() {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        redirect("/login")
    }

    const initialOrders = await getInitialOrders()
    return <AdminMerchOrdersClient initialOrders={initialOrders} />
}
