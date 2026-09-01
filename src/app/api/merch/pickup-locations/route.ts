import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
    try {
        const locations = await prisma.merchPickupLocation.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                address: true,
                district: true,
                instructions: true,
            },
        })

        return NextResponse.json(
            { success: true, data: locations },
            { headers: { "Cache-Control": "no-store" } }
        )
    } catch (error) {
        console.error("Error fetching merch pickup locations:", error)
        return NextResponse.json(
            { success: false, error: "No se pudieron cargar las sedes de recojo." },
            { status: 500 }
        )
    }
}
