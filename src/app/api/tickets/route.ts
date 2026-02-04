import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
export const runtime = "nodejs"

// GET /api/tickets - Get user's tickets
export async function GET() {
    try {
        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const tickets = await prisma.ticket.findMany({
            where: { userId: user.id },
            include: {
                event: true,
                ticketType: true,
                entitlements: {
                    orderBy: { date: "asc" },
                },
                order: {
                    select: {
                        id: true,
                        status: true,
                        paidAt: true,
                    },
                },
                courtesyInfo: true,
            },
            orderBy: { createdAt: "desc" },
        })

        return NextResponse.json({
            success: true,
            data: tickets,
        })
    } catch (error) {
        console.error("Error fetching tickets:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener tickets" },
            { status: 500 }
        )
    }
}

