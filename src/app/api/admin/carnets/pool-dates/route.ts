import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// El nombre de la ruta viene de cuando solo piscina libre tenia cupo por
// fecha. Ahora cualquier ticketType con cupo por fecha (piscina libre o
// EVENTO+capacityByDate, ver `usesTicketDateCapacity`) puede consultarse aca:
// la query es por ticketTypeId, sin asumir la categoria del evento.
export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const ticketTypeId = new URL(request.url).searchParams.get("ticketTypeId")?.trim()
        if (!ticketTypeId) {
            return NextResponse.json({ success: false, error: "Falta ticketTypeId" }, { status: 400 })
        }

        const rows = await prisma.ticketTypeDateInventory.findMany({
            where: { ticketTypeId },
            orderBy: { date: "asc" },
            select: { date: true, capacity: true, sold: true, isEnabled: true },
        })

        return NextResponse.json({
            success: true,
            data: {
                dates: rows.map((row) => ({
                    date: row.date.toISOString().slice(0, 10),
                    capacity: row.capacity,
                    sold: row.sold,
                    isEnabled: row.isEnabled,
                })),
            },
        })
    } catch (error) {
        console.error("Error cargando fechas de cupo por fecha:", error)
        return NextResponse.json({ success: false, error: "Error al cargar fechas" }, { status: 500 })
    }
}
