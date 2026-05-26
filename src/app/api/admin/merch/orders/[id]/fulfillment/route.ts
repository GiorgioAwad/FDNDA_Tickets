import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { FulfillmentStatus, Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import {
    sendMerchFulfillmentStatusEmail,
    type MerchFulfillmentNotifyStatus,
    type MerchOrderEmailItem,
} from "@/lib/email"

export const runtime = "nodejs"

const NOTIFY_STATUSES = new Set<MerchFulfillmentNotifyStatus>([
    "READY",
    "SHIPPED",
    "DELIVERED",
    "PICKED_UP",
    "CANCELLED",
])

const fulfillmentSchema = z.object({
    fulfillmentStatus: z.enum(["PENDING", "READY", "SHIPPED", "DELIVERED", "PICKED_UP", "CANCELLED"]),
    trackingCode: z.string().trim().max(120).optional().nullable(),
    notify: z.boolean().optional(),
})

function isNotifiable(status: FulfillmentStatus): status is FulfillmentStatus & MerchFulfillmentNotifyStatus {
    return NOTIFY_STATUSES.has(status as MerchFulfillmentNotifyStatus)
}

function extractEmailItems(order: { orderItems: Array<{
    quantity: number
    unitPrice: Prisma.Decimal
    merchSnapshot: Prisma.JsonValue
    merchVariant: { size: string | null; product: { name: string; zone: string } } | null
}>}): MerchOrderEmailItem[] {
    return order.orderItems.map((item) => {
        const snapshot = (item.merchSnapshot && typeof item.merchSnapshot === "object" && !Array.isArray(item.merchSnapshot))
            ? (item.merchSnapshot as Record<string, unknown>)
            : {}
        const productName =
            (typeof snapshot.productName === "string" && snapshot.productName) ||
            item.merchVariant?.product.name ||
            "Producto"
        const size =
            (typeof snapshot.size === "string" && snapshot.size) ||
            item.merchVariant?.size ||
            null
        const zone =
            (typeof snapshot.zone === "string" && snapshot.zone) ||
            item.merchVariant?.product.zone ||
            null

        return {
            productName,
            size,
            zone,
            quantity: item.quantity,
            unitPrice: Number(item.unitPrice),
        }
    })
}

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const { id } = await params
    if (!id) {
        return NextResponse.json({ success: false, error: "Falta id de orden" }, { status: 400 })
    }

    let body: unknown
    try {
        body = await request.json()
    } catch {
        return NextResponse.json({ success: false, error: "Body invalido" }, { status: 400 })
    }

    const parsed = fulfillmentSchema.safeParse(body)
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: parsed.error.issues[0]?.message || "Datos invalidos" },
            { status: 400 }
        )
    }

    const { fulfillmentStatus, trackingCode, notify = true } = parsed.data

    const existing = await prisma.order.findUnique({
        where: { id },
        select: {
            id: true,
            orderType: true,
            fulfillmentStatus: true,
            trackingCode: true,
            deliveryMethod: true,
            shippingAddress: true,
            shippingDistrito: true,
            buyerEmail: true,
            buyerName: true,
            user: { select: { name: true, email: true } },
            orderItems: {
                select: {
                    quantity: true,
                    unitPrice: true,
                    merchSnapshot: true,
                    merchVariant: {
                        select: {
                            size: true,
                            product: { select: { name: true, zone: true } },
                        },
                    },
                },
            },
        },
    })

    if (!existing || existing.orderType !== "MERCH") {
        return NextResponse.json({ success: false, error: "Orden de merch no encontrada" }, { status: 404 })
    }

    if (fulfillmentStatus === "SHIPPED" && !trackingCode?.trim() && !existing.trackingCode) {
        return NextResponse.json(
            { success: false, error: "Falta codigo de tracking para marcar como enviado" },
            { status: 400 }
        )
    }

    const trackingValue =
        trackingCode === null
            ? null
            : trackingCode?.trim()
                ? trackingCode.trim()
                : existing.trackingCode

    const isTerminal = fulfillmentStatus === "DELIVERED" || fulfillmentStatus === "PICKED_UP"
    const statusChanged = existing.fulfillmentStatus !== fulfillmentStatus

    const updated = await prisma.order.update({
        where: { id },
        data: {
            fulfillmentStatus,
            trackingCode: trackingValue,
            fulfilledAt: isTerminal ? new Date() : null,
        },
        select: {
            id: true,
            fulfillmentStatus: true,
            fulfilledAt: true,
            trackingCode: true,
        },
    })

    let emailSent = false
    let emailError: string | null = null

    if (notify && statusChanged && isNotifiable(fulfillmentStatus)) {
        const recipient = existing.buyerEmail || existing.user.email
        const recipientName = existing.buyerName || existing.user.name || "compradore"

        if (recipient) {
            const result = await sendMerchFulfillmentStatusEmail({
                email: recipient,
                name: recipientName,
                orderId: existing.id,
                status: fulfillmentStatus,
                deliveryMethod: existing.deliveryMethod,
                trackingCode: trackingValue,
                shippingAddress: existing.shippingAddress,
                shippingDistrito: existing.shippingDistrito,
                items: extractEmailItems(existing),
            })
            emailSent = result.success
            emailError = result.success ? null : result.error || "Error desconocido al enviar email"
        }
    }

    return NextResponse.json({
        success: true,
        data: {
            order: updated,
            statusChanged,
            emailSent,
            emailError,
        },
    })
}
