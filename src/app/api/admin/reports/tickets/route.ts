import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        // Fetch all tickets with related data
        const tickets = await prisma.ticket.findMany({
            include: {
                ticketType: {
                    select: {
                        name: true,
                        price: true,
                    }
                },
                event: {
                    select: {
                        title: true,
                    }
                },
                user: {
                    select: {
                        name: true,
                        email: true,
                    }
                },
                _count: {
                    select: {
                        scans: true,
                    }
                }
            },
            orderBy: { createdAt: "desc" }
        })

        // Calculate stats
        const total = tickets.length
        const active = tickets.filter(t => t.status === "ACTIVE").length
        const used = tickets.filter(t => t.status === "EXPIRED").length  // No "USED" status, using EXPIRED as alternative
        const cancelled = tickets.filter(t => t.status === "CANCELLED").length

        return NextResponse.json({
            success: true,
            data: {
                tickets: tickets.map(t => ({
                    ...t,
                    ticketType: {
                        ...t.ticketType,
                        price: Number(t.ticketType.price),
                    }
                })),
                total,
                active,
                used,
                cancelled,
            }
        })
    } catch (error) {
        console.error("Error fetching tickets:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener entradas" },
            { status: 500 }
        )
    }
}
