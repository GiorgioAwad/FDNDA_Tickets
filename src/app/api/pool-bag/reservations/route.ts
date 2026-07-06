import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { formatDateUTC } from "@/lib/qr"
import { reservePoolVisit } from "@/lib/pool-bag-service"
import { getPoolBagCredits, isPoolBagTicketType } from "@/lib/pool-bag"

export const runtime = "nodejs"

const reserveSchema = z.object({
    ticketId: z.string().min(1),
    slotTicketTypeId: z.string().min(1),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha invalida"),
})

// Reservas (no canceladas) + créditos de una bolsa que pertenece al usuario.
async function loadBagReservations(ticketId: string, userId: string) {
    const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, userId },
        include: {
            ticketType: { select: { isPackage: true, packageDaysCount: true } },
            event: { select: { category: true } },
            poolReservations: {
                where: { status: { in: ["RESERVED", "USED"] } },
                orderBy: [{ date: "asc" }, { shift: "asc" }],
                select: { id: true, date: true, shift: true, status: true, usedAt: true },
            },
        },
    })

    if (
        !ticket ||
        !isPoolBagTicketType({
            eventCategory: ticket.event.category,
            isPackage: ticket.ticketType.isPackage,
            packageDaysCount: ticket.ticketType.packageDaysCount,
        })
    ) {
        return null
    }

    const reservations = ticket.poolReservations.map((r) => ({
        id: r.id,
        date: formatDateUTC(r.date),
        shift: r.shift,
        status: r.status,
        usedAt: r.usedAt ? r.usedAt.toISOString() : null,
    }))

    return {
        credits: getPoolBagCredits(ticket.poolReservations, ticket.ticketType.packageDaysCount),
        reservations,
    }
}

// GET /api/pool-bag/reservations?ticketId=... — reservas + créditos de la bolsa.
export async function GET(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user) {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const ticketId = new URL(request.url).searchParams.get("ticketId")
    if (!ticketId) {
        return NextResponse.json({ success: false, error: "ticketId requerido" }, { status: 400 })
    }

    const data = await loadBagReservations(ticketId, user.id)
    if (!data) {
        return NextResponse.json({ success: false, error: "Bolsa no encontrada" }, { status: 404 })
    }

    return NextResponse.json({ success: true, data })
}

// POST /api/pool-bag/reservations — reserva una visita (día + horario).
export async function POST(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user) {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const { success: rateOk } = await rateLimit(`poolbag:${user.id}`, "api")
    if (!rateOk) {
        return NextResponse.json(
            { success: false, error: "Demasiados intentos. Espera un momento." },
            { status: 429 }
        )
    }

    const parsed = reserveSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: parsed.error.issues[0]?.message || "Datos invalidos" },
            { status: 400 }
        )
    }

    const result = await reservePoolVisit({
        userId: user.id,
        ticketId: parsed.data.ticketId,
        slotTicketTypeId: parsed.data.slotTicketTypeId,
        date: parsed.data.date,
    })

    if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }

    const data = await loadBagReservations(parsed.data.ticketId, user.id)
    return NextResponse.json({
        success: true,
        data: {
            reservation: {
                id: result.reservationId,
                date: result.date,
                shift: result.shift,
                slotName: result.slotName,
            },
            ...(data ?? {}),
        },
    })
}
