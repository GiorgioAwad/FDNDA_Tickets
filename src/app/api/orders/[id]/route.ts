import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
export const runtime = "nodejs"

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params

        const order = await prisma.order.findUnique({
            where: { id },
            select: {
                id: true,
                userId: true,
                status: true,
                totalAmount: true,
                currency: true,
                paidAt: true,
                orderItems: {
                    select: {
                        ticketType: {
                            select: {
                                event: { select: { title: true } },
                            },
                        },
                    },
                },
            },
        })

        if (!order) {
            return NextResponse.json(
                { success: false, error: "Orden no encontrada" },
                { status: 404 }
            )
        }

        if (order.userId !== user.id && !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 403 }
            )
        }

        const eventTitle = order.orderItems[0]?.ticketType.event.title || null

        return NextResponse.json(
            {
                success: true,
                data: {
                    id: order.id,
                    status: order.status,
                    totalAmount: order.totalAmount,
                    currency: order.currency,
                    paidAt: order.paidAt,
                    eventTitle,
                },
            },
            { headers: { "Cache-Control": "no-store" } }
        )
    } catch (error) {
        console.error("Error fetching order:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener orden" },
            { status: 500 }
        )
    }
}

