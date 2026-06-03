import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Resumen de entradas vendidas por horario (ticket type) para el staff del scanner.
 * Para eventos PISCINA_LIBRE, los cupos son por fecha: se usa el inventario del dia
 * indicado (?date=YYYY-MM-DD) y solo se devuelven los horarios habilitados ese dia.
 * Para el resto, se usa el contador del tipo de entrada.
 */
export async function GET(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user || !hasRole(user.role, "STAFF")) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const eventId = searchParams.get("eventId")
    const dateStr = searchParams.get("date") // YYYY-MM-DD (opcional)
    if (!eventId) {
        return NextResponse.json({ error: "Falta eventId" }, { status: 400 })
    }

    const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { id: true, title: true, category: true },
    })
    if (!event) {
        return NextResponse.json({ error: "Evento no encontrado" }, { status: 404 })
    }

    const isPoolFree = event.category === "PISCINA_LIBRE"
    const ticketTypes = await prisma.ticketType.findMany({
        where: { eventId, isActive: true },
        select: { id: true, name: true, capacity: true, sold: true },
        orderBy: { sortOrder: "asc" },
    })

    type Slot = { ticketTypeId: string; name: string; sold: number; capacity: number }
    let slots: Slot[]

    if (isPoolFree && dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, m, d] = dateStr.split("-").map(Number)
        const date = new Date(Date.UTC(y, m - 1, d))
        const invs = await prisma.ticketTypeDateInventory.findMany({
            where: { ticketTypeId: { in: ticketTypes.map((t) => t.id) }, date },
            select: { ticketTypeId: true, sold: true, capacity: true, isEnabled: true },
        })
        const invMap = new Map(invs.map((i) => [i.ticketTypeId, i]))
        slots = ticketTypes
            .map((t) => {
                const inv = invMap.get(t.id)
                // Sin inventario ese dia = horario cerrado -> se omite
                if (!inv || !inv.isEnabled) return null
                return { ticketTypeId: t.id, name: t.name, sold: inv.sold, capacity: inv.capacity }
            })
            .filter((s): s is Slot => s !== null)
    } else {
        slots = ticketTypes.map((t) => ({
            ticketTypeId: t.id,
            name: t.name,
            sold: t.sold,
            capacity: t.capacity,
        }))
    }

    const totalSold = slots.reduce((acc, s) => acc + s.sold, 0)
    const totalCapacity = slots.reduce((acc, s) => acc + s.capacity, 0)

    return NextResponse.json({
        data: {
            eventTitle: event.title,
            isPoolFree,
            date: dateStr || null,
            totalSold,
            totalCapacity,
            slots,
        },
    })
}
