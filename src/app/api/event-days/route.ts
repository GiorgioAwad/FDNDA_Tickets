import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseDateOnly } from "@/lib/utils"
export const runtime = "nodejs"

// POST /api/event-days - Create event day
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const { eventId, date, openTime, closeTime, capacity } = body

        if (!eventId || !date || !openTime || !closeTime) {
            return NextResponse.json({ success: false, error: "Faltan datos requeridos" }, { status: 400 })
        }

        const parsedDate = parseDateOnly(date)
        if (Number.isNaN(parsedDate.getTime())) {
            return NextResponse.json({ success: false, error: "Fecha inválida" }, { status: 400 })
        }

        const eventDay = await prisma.eventDay.create({
            data: {
                eventId,
                date: parsedDate,
                openTime,
                closeTime,
                capacity: Number(capacity ?? 0),
            },
        })

        return NextResponse.json({ success: true, data: eventDay })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error al crear día"
        console.error("Error creating event day:", error)
        return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
}

// PUT /api/event-days - Update event day
export async function PUT(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const { id, date, openTime, closeTime, capacity } = body

        if (!id) {
            return NextResponse.json({ success: false, error: "ID requerido" }, { status: 400 })
        }

        const parsedDate = date ? parseDateOnly(date) : undefined
        if (parsedDate && Number.isNaN(parsedDate.getTime())) {
            return NextResponse.json({ success: false, error: "Fecha inválida" }, { status: 400 })
        }

        const eventDay = await prisma.eventDay.update({
            where: { id },
            data: {
                date: parsedDate,
                openTime,
                closeTime,
                capacity: capacity !== undefined ? Number(capacity) : undefined,
            },
        })

        return NextResponse.json({ success: true, data: eventDay })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error al actualizar día"
        console.error("Error updating event day:", error)
        return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
}

// DELETE /api/event-days?id=xxx
export async function DELETE(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const id = searchParams.get("id")

        if (!id) {
            return NextResponse.json({ success: false, error: "ID requerido" }, { status: 400 })
        }

        await prisma.eventDay.delete({ where: { id } })
        return NextResponse.json({ success: true, message: "Día eliminado" })
    } catch (error) {
        const message = error instanceof Error ? error.message : "Error al eliminar día"
        console.error("Error deleting event day:", error)
        return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
}
