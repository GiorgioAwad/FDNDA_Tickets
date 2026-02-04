import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseDateOnly } from "@/lib/utils"
import { getCachedEventWithTicketTypes, onEventUpdated } from "@/lib/cached-queries"
export const runtime = "nodejs"

// GET /api/events/[id] - Get event details
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const { searchParams } = new URL(request.url)
        const skipCache = searchParams.get("fresh") === "true"

        // Para requests públicos, usar cache
        if (!skipCache) {
            const cachedEvent = await getCachedEventWithTicketTypes(id)
            if (cachedEvent) {
                return NextResponse.json({
                    success: true,
                    data: cachedEvent,
                })
            }
        }

        // Fallback a DB directa
        const event = await prisma.event.findUnique({
            where: { id },
            include: {
                ticketTypes: {
                    where: { isActive: true },
                    orderBy: { sortOrder: "asc" },
                },
                eventDays: {
                    orderBy: { date: "asc" },
                },
            },
        })

        if (!event) {
            return NextResponse.json(
                { success: false, error: "Evento no encontrado" },
                { status: 404 }
            )
        }

        return NextResponse.json({
            success: true,
            data: event,
        })
    } catch (error) {
        console.error("Error fetching event:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener evento" },
            { status: 500 }
        )
    }
}

// PUT /api/events/[id] - Update event (Admin only)
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params
        const body = await request.json()

        // Extract fields to update
        const {
            title,
            description,
            location,
            venue,
            startDate,
            endDate,
            mode,
            isPublished,
            bannerUrl,
            discipline,
        } = body

        const parsedStartDate = startDate ? parseDateOnly(startDate) : undefined
        const parsedEndDate = endDate ? parseDateOnly(endDate) : undefined

        if (parsedStartDate && Number.isNaN(parsedStartDate.getTime())) {
            return NextResponse.json(
                { success: false, error: "Fecha de inicio inválida" },
                { status: 400 }
            )
        }

        if (parsedEndDate && Number.isNaN(parsedEndDate.getTime())) {
            return NextResponse.json(
                { success: false, error: "Fecha de fin inválida" },
                { status: 400 }
            )
        }

        if (parsedStartDate && parsedEndDate && parsedStartDate > parsedEndDate) {
            return NextResponse.json(
                { success: false, error: "La fecha de fin no puede ser anterior a la fecha de inicio" },
                { status: 400 }
            )
        }

        const event = await prisma.event.update({
            where: { id },
            data: {
                title,
                description,
                location,
                venue,
                startDate: parsedStartDate,
                endDate: parsedEndDate,
                mode,
                isPublished,
                bannerUrl,
                discipline,
            },
        })

        // Invalidar cache
        await onEventUpdated(id, event.slug)

        return NextResponse.json({
            success: true,
            data: event,
        })
    } catch (error) {
        console.error("Error updating event:", error)
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Error al actualizar evento",
            },
            { status: 500 }
        )
    }
}

// DELETE /api/events/[id] - Delete event (Admin only)
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { id } = await params

        // Check if event has tickets sold
        const ticketsSold = await prisma.ticket.count({
            where: { eventId: id },
        })

        if (ticketsSold > 0) {
            return NextResponse.json(
                { success: false, error: "No se puede eliminar un evento con entradas vendidas" },
                { status: 400 }
            )
        }

        // Obtener slug antes de eliminar para invalidar cache
        const eventToDelete = await prisma.event.findUnique({
            where: { id },
            select: { slug: true },
        })

        await prisma.event.delete({
            where: { id },
        })

        // Invalidar cache
        if (eventToDelete) {
            await onEventUpdated(id, eventToDelete.slug)
        }

        return NextResponse.json({
            success: true,
            message: "Evento eliminado",
        })
    } catch (error) {
        console.error("Error deleting event:", error)
        return NextResponse.json(
            { success: false, error: "Error al eliminar evento" },
            { status: 500 }
        )
    }
}

