import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { invalidateTicketTypeCache } from "@/lib/cache"
export const runtime = "nodejs"

// POST /api/ticket-types - Create a new ticket type
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const {
            eventId,
            name,
            price,
            capacity,
            isPackage,
            packageDaysCount,
            validDays,
        } = body

        if (!eventId || !name || price === undefined || capacity === undefined) {
            return NextResponse.json(
                { success: false, error: "Faltan datos requeridos" },
                { status: 400 }
            )
        }

        const ticketType = await prisma.ticketType.create({
            data: {
                eventId,
                name,
                price: Number(price),
                capacity: Number(capacity),
                isPackage: isPackage || false,
                packageDaysCount: packageDaysCount ? Number(packageDaysCount) : null,
                validDays: validDays || [],
            },
        })

        // Invalidar cache
        await invalidateTicketTypeCache(eventId)

        return NextResponse.json({
            success: true,
            data: ticketType,
        })
    } catch (error) {
        console.error("Error creating ticket type:", error)
        return NextResponse.json(
            { success: false, error: "Error al crear tipo de entrada" },
            { status: 500 }
        )
    }
}

// PUT /api/ticket-types - Update ticket type
export async function PUT(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const {
            id,
            name,
            price,
            capacity,
            isActive,
        } = body

        if (!id) {
            return NextResponse.json(
                { success: false, error: "ID requerido" },
                { status: 400 }
            )
        }

        const ticketType = await prisma.ticketType.update({
            where: { id },
            data: {
                name,
                price: price !== undefined ? Number(price) : undefined,
                capacity: capacity !== undefined ? Number(capacity) : undefined,
                isActive,
            },
        })

        // Invalidar cache
        await invalidateTicketTypeCache(ticketType.eventId)

        return NextResponse.json({
            success: true,
            data: ticketType,
        })
    } catch (error) {
        console.error("Error updating ticket type:", error)
        return NextResponse.json(
            { success: false, error: "Error al actualizar tipo de entrada" },
            { status: 500 }
        )
    }
}

// DELETE /api/ticket-types?id=xxx
export async function DELETE(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { searchParams } = new URL(request.url)
        const id = searchParams.get("id")

        if (!id) {
            return NextResponse.json(
                { success: false, error: "ID requerido" },
                { status: 400 }
            )
        }

        // Obtener eventId antes de cualquier operación
        const ticketType = await prisma.ticketType.findUnique({
            where: { id },
            select: { eventId: true },
        })

        if (!ticketType) {
            return NextResponse.json(
                { success: false, error: "Tipo de entrada no encontrado" },
                { status: 404 }
            )
        }

        // Check if sold
        const sold = await prisma.ticket.count({
            where: { ticketTypeId: id },
        })

        if (sold > 0) {
            // Soft delete (deactivate) if sold
            await prisma.ticketType.update({
                where: { id },
                data: { isActive: false },
            })
            
            // Invalidar cache
            await invalidateTicketTypeCache(ticketType.eventId)
            
            return NextResponse.json({
                success: true,
                message: "Tipo de entrada desactivado (tiene ventas)",
            })
        }

        await prisma.ticketType.delete({
            where: { id },
        })

        // Invalidar cache
        await invalidateTicketTypeCache(ticketType.eventId)

        return NextResponse.json({
            success: true,
            message: "Tipo de entrada eliminado",
        })
    } catch (error) {
        console.error("Error deleting ticket type:", error)
        return NextResponse.json(
            { success: false, error: "Error al eliminar tipo de entrada" },
            { status: 500 }
        )
    }
}

