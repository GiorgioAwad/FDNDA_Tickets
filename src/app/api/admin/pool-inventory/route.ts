import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { invalidateTicketTypeCache } from "@/lib/cache"
import { isPoolFreeEventCategory } from "@/lib/pool-free"
import { parseDateOnly } from "@/lib/utils"

export const runtime = "nodejs"

type IncomingCell = {
    ticketTypeId?: unknown
    capacity?: unknown
    isEnabled?: unknown
}

const normalizeCapacity = (value: unknown): number => {
    const num = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(num) || num < 0) return 0
    return Math.floor(num)
}

// Guarda los cupos (capacity + isEnabled) de un dia concreto para una piscina
// libre. Cada celda es un (ticketType, date); NO se propaga a otras fechas.
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const { eventId, date, cells } = body as {
            eventId?: string
            date?: string
            cells?: IncomingCell[]
        }

        if (!eventId || !date || !Array.isArray(cells) || cells.length === 0) {
            return NextResponse.json(
                { success: false, error: "Faltan datos requeridos" },
                { status: 400 }
            )
        }

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            select: { id: true, category: true },
        })

        if (!event) {
            return NextResponse.json({ success: false, error: "Evento no encontrado" }, { status: 404 })
        }
        if (!isPoolFreeEventCategory(event.category)) {
            return NextResponse.json(
                { success: false, error: "Esta vista solo aplica a eventos de piscina libre" },
                { status: 400 }
            )
        }

        const normalizedDate = typeof date === "string" && date.trim() ? parseDateOnly(date.trim()) : null
        if (!normalizedDate || Number.isNaN(normalizedDate.getTime())) {
            return NextResponse.json({ success: false, error: "Fecha invalida" }, { status: 400 })
        }

        // Solo permitimos celdas de horarios que pertenezcan a este evento.
        const eventTicketTypes = await prisma.ticketType.findMany({
            where: { eventId },
            select: { id: true },
        })
        const validTicketTypeIds = new Set(eventTicketTypes.map((t) => t.id))

        // Ventas actuales por horario para esa fecha (para no permitir sobreventa).
        const existing = await prisma.ticketTypeDateInventory.findMany({
            where: {
                date: normalizedDate,
                ticketTypeId: { in: Array.from(validTicketTypeIds) },
            },
            select: { ticketTypeId: true, sold: true },
        })
        const soldByTicketType = new Map(existing.map((row) => [row.ticketTypeId, row.sold]))

        const operations = []
        const adjustments: Array<{ ticketTypeId: string; requested: number; applied: number; sold: number }> = []

        for (const cell of cells) {
            const ticketTypeId = typeof cell.ticketTypeId === "string" ? cell.ticketTypeId : ""
            if (!ticketTypeId || !validTicketTypeIds.has(ticketTypeId)) {
                return NextResponse.json(
                    { success: false, error: "Un horario no pertenece a este evento" },
                    { status: 400 }
                )
            }

            const isEnabled = Boolean(cell.isEnabled)
            const requested = normalizeCapacity(cell.capacity)
            const sold = soldByTicketType.get(ticketTypeId) ?? 0
            // capacity = 0 -> ilimitado. Nunca por debajo de lo ya vendido.
            const applied = requested > 0 && requested < sold ? sold : requested
            if (applied !== requested) {
                adjustments.push({ ticketTypeId, requested, applied, sold })
            }

            operations.push(
                prisma.ticketTypeDateInventory.upsert({
                    where: { ticketTypeId_date: { ticketTypeId, date: normalizedDate } },
                    update: { capacity: applied, isEnabled },
                    create: {
                        ticketTypeId,
                        date: normalizedDate,
                        capacity: applied,
                        sold: 0,
                        isEnabled,
                    },
                })
            )
        }

        const updated = await prisma.$transaction(operations)
        await invalidateTicketTypeCache(eventId)

        return NextResponse.json({
            success: true,
            adjustments,
            data: updated.map((row) => ({
                ticketTypeId: row.ticketTypeId,
                capacity: row.capacity,
                sold: row.sold,
                isEnabled: row.isEnabled,
            })),
        })
    } catch (error) {
        console.error("Error saving pool inventory:", error)
        return NextResponse.json(
            { success: false, error: "Error al guardar los cupos del dia" },
            { status: 500 }
        )
    }
}
