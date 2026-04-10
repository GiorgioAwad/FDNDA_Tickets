import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const ticketTypes = await prisma.ticketType.findMany({
            where: {
                eventId: id,
                isActive: true,
            },
            select: {
                id: true,
                sold: true,
                capacity: true,
                isActive: true,
                updatedAt: true,
                dateInventories: {
                    select: {
                        date: true,
                        sold: true,
                        capacity: true,
                        isEnabled: true,
                    },
                    orderBy: { date: "asc" },
                },
            },
            orderBy: { sortOrder: "asc" },
        })

        return NextResponse.json(
            {
                success: true,
                data: ticketTypes,
                updatedAt: new Date().toISOString(),
            },
            {
                headers: {
                    "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
                },
            }
        )
    } catch (error) {
        console.error("Error fetching event stock:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener stock" },
            { status: 500 }
        )
    }
}
