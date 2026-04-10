import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

interface OrderWithRelations {
    id: string
    userId: string
    status: string
    totalAmount: { toNumber: () => number }
    currency: string
    provider: string
    providerRef: string | null
    providerOrderNumber: string | null
    providerTransactionId: string | null
    paymentSyncAttempts: number
    paymentLastSyncAt: Date | null
    paymentNeedsReview: boolean
    paidAt: Date | null
    createdAt: Date
    user: { name: string | null; email: string }
    orderItems: Array<{
        id: string
        ticketTypeId: string
        quantity: number
        unitPrice: { toNumber: () => number }
        subtotal: { toNumber: () => number }
        ticketType: {
            name: string
            price: { toNumber: () => number }
            event: { title: string }
        }
    }>
    tickets: Array<{
        id: string
        attendeeName: string | null
        attendeeDni: string | null
        status: string
        ticketCode: string
        ticketTypeId: string
    }>
}

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const orders = await prisma.order.findMany({
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                    },
                },
                orderItems: {
                    select: {
                        id: true,
                        ticketTypeId: true,
                        quantity: true,
                        unitPrice: true,
                        subtotal: true,
                        ticketType: {
                            select: {
                                name: true,
                                price: true,
                                event: {
                                    select: {
                                        title: true,
                                    },
                                },
                            },
                        },
                    },
                },
                tickets: {
                    select: {
                        id: true,
                        attendeeName: true,
                        attendeeDni: true,
                        status: true,
                        ticketCode: true,
                        ticketTypeId: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        }) as unknown as OrderWithRelations[]

        const totalPaid = orders
            .filter((order) => order.status === "PAID")
            .reduce((acc, order) => acc + order.totalAmount.toNumber(), 0)

        const totalPending = orders
            .filter((order) => order.status === "PENDING")
            .reduce((acc, order) => acc + order.totalAmount.toNumber(), 0)

        const totalCancelled = orders
            .filter((order) => order.status === "CANCELLED")
            .reduce((acc, order) => acc + order.totalAmount.toNumber(), 0)

        return NextResponse.json({
            success: true,
            data: {
                orders: orders.map((order) => ({
                    id: order.id,
                    totalAmount: order.totalAmount.toNumber(),
                    status: order.status,
                    provider: order.provider,
                    providerRef: order.providerRef,
                    providerOrderNumber: order.providerOrderNumber,
                    providerTransactionId: order.providerTransactionId,
                    paymentSyncAttempts: order.paymentSyncAttempts,
                    paymentLastSyncAt: order.paymentLastSyncAt,
                    paymentNeedsReview: order.paymentNeedsReview,
                    createdAt: order.createdAt,
                    paidAt: order.paidAt,
                    user: order.user,
                    items: order.orderItems.map((item) => ({
                        id: item.id,
                        quantity: item.quantity,
                        subtotal: item.subtotal.toNumber(),
                        ticketType: {
                            name: item.ticketType.name,
                            price: item.unitPrice.toNumber(),
                            event: item.ticketType.event,
                        },
                        tickets: order.tickets.filter(
                            (ticket) => ticket.ticketTypeId === item.ticketTypeId
                        ),
                    })),
                })),
                totalPaid,
                totalPending,
                totalCancelled,
            },
        })
    } catch (error) {
        console.error("Error fetching income:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener ingresos" },
            { status: 500 }
        )
    }
}
