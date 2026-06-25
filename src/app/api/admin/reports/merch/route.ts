import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { extractOrderPaymentDetails } from "@/lib/payment-details"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

interface MerchSnapshot {
    productName?: string
    category?: string
    zone?: string
    size?: string | null
    sku?: string
}

function readMerchSnapshot(value: Prisma.JsonValue | null | undefined): MerchSnapshot {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as MerchSnapshot
}

function toNumber(value: Prisma.Decimal | null | undefined): number {
    return value ? Number(value) : 0
}

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const orders = await prisma.order.findMany({
            where: { orderType: "MERCH" },
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
                orderItems: {
                    include: {
                        merchVariant: {
                            select: {
                                size: true,
                                sku: true,
                                product: {
                                    select: {
                                        name: true,
                                        category: true,
                                        zone: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        })

        const totalPaid = orders
            .filter((order) => order.status === "PAID")
            .reduce((sum, order) => sum + Number(order.totalAmount), 0)
        const totalPending = orders
            .filter((order) => order.status === "PENDING")
            .reduce((sum, order) => sum + Number(order.totalAmount), 0)
        const totalCancelled = orders
            .filter((order) => order.status === "CANCELLED" || order.status === "REFUNDED")
            .reduce((sum, order) => sum + Number(order.totalAmount), 0)
        const totalItemsSold = orders
            .filter((order) => order.status === "PAID")
            .reduce(
                (sum, order) =>
                    sum + order.orderItems.reduce((itemSum, item) => itemSum + item.quantity, 0),
                0
            )
        const provinceShipments = orders.filter(
            (order) => order.status === "PAID" && order.deliveryMethod === "SHIPPING_HOME"
        ).length

        return NextResponse.json({
            success: true,
            data: {
                totalPaid,
                totalPending,
                totalCancelled,
                totalItemsSold,
                provinceShipments,
                orders: orders.map((order) => {
                    const paymentDetails = extractOrderPaymentDetails(order)

                    return {
                        id: order.id,
                        status: order.status,
                        totalAmount: Number(order.totalAmount),
                        currency: order.currency,
                        provider: order.provider,
                        providerRef: order.providerRef,
                        providerOrderNumber: order.providerOrderNumber,
                        providerTransactionId: order.providerTransactionId,
                        paymentOperationNumber: paymentDetails.operationNumber,
                        paymentMethod: paymentDetails.methodLabel,
                        paymentNeedsReview: order.paymentNeedsReview,
                        createdAt: order.createdAt,
                        paidAt: order.paidAt,
                        deliveryMethod: order.deliveryMethod,
                        fulfillmentStatus: order.fulfillmentStatus,
                        shippingCost: toNumber(order.shippingCost),
                        shippingAddress: order.shippingAddress,
                        shippingDistrito: order.shippingDistrito,
                        shippingUbigeo: order.shippingUbigeo,
                        shippingReference: order.shippingReference,
                        shippingPhone: order.shippingPhone,
                        documentType: order.documentType,
                        buyerDocNumber: order.buyerDocNumber,
                        buyerName: order.buyerName,
                        buyerPhone: order.buyerPhone,
                        user: order.user,
                        items: order.orderItems.map((item) => {
                            const snapshot = readMerchSnapshot(item.merchSnapshot)

                            return {
                                id: item.id,
                                quantity: item.quantity,
                                unitPrice: Number(item.unitPrice),
                                subtotal: Number(item.subtotal),
                                productName:
                                    snapshot.productName ||
                                    item.merchVariant?.product.name ||
                                    "Producto merch",
                                category:
                                    snapshot.category ||
                                    item.merchVariant?.product.category ||
                                    "OTROS",
                                zone:
                                    snapshot.zone ||
                                    item.merchVariant?.product.zone ||
                                    "GENERICA",
                                size: snapshot.size ?? item.merchVariant?.size ?? null,
                                sku: snapshot.sku || item.merchVariant?.sku || null,
                            }
                        }),
                    }
                }),
            },
        })
    } catch (error) {
        console.error("Error fetching merch report:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener reporte de merch" },
            { status: 500 }
        )
    }
}
