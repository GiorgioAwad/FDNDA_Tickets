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
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        // Fetch all orders with related data
        const orders = await prisma.order.findMany({
            include: {
                user: {
                    select: {
                        name: true,
                        email: true,
                    }
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
                                    }
                                }
                            }
                        }
                    }
                },
                tickets: {
                    select: {
                        id: true,
                        attendeeName: true,
                        attendeeDni: true,
                        status: true,
                        ticketCode: true,
                        ticketTypeId: true,
                    }
                }
            },
            orderBy: { createdAt: "desc" }
        }) as unknown as OrderWithRelations[]

        // Calculate totals
        const totalPaid = orders
            .filter(o => o.status === "PAID")
            .reduce((acc, o) => acc + o.totalAmount.toNumber(), 0)

        const totalPending = orders
            .filter(o => o.status === "PENDING")
            .reduce((acc, o) => acc + o.totalAmount.toNumber(), 0)

        const totalCancelled = orders
            .filter(o => o.status === "CANCELLED")
            .reduce((acc, o) => acc + o.totalAmount.toNumber(), 0)

        return NextResponse.json({
            success: true,
            data: {
                orders: orders.map(o => ({
                    id: o.id,
                    totalAmount: o.totalAmount.toNumber(),
                    status: o.status,
                    provider: o.provider,
                    providerRef: o.providerRef,
                    createdAt: o.createdAt,
                    paidAt: o.paidAt,
                    user: o.user,
                    items: o.orderItems.map(i => ({
                        id: i.id,
                        quantity: i.quantity,
                        subtotal: i.subtotal.toNumber(),
                        ticketType: {
                            name: i.ticketType.name,
                            price: i.unitPrice.toNumber(),
                            event: i.ticketType.event
                        },
                        tickets: o.tickets.filter(t => t.ticketTypeId === i.ticketTypeId),
                    }))
                })),
                totalPaid,
                totalPending,
                totalCancelled,
            }
        })
    } catch (error) {
        console.error("Error fetching income:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener ingresos" },
            { status: 500 }
        )
    }
}
