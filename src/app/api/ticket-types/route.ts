import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { invalidateTicketTypeCache } from "@/lib/cache"
import { buildTicketValidDaysPayload, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import type { Prisma } from "@prisma/client"

export const runtime = "nodejs"

const normalizePackageDaysCount = (value: unknown): number | null => {
    if (value === undefined || value === null || value === "") return null
    const num = typeof value === "number" ? value : Number(value)
    if (!Number.isFinite(num) || num <= 0) return null
    return Math.floor(num)
}

const normalizeValidDays = (value: unknown): Prisma.InputJsonValue => {
    const config = parseTicketScheduleConfig(value)
    return buildTicketValidDaysPayload(config) as Prisma.InputJsonValue
}

const normalizeDescription = (value: unknown): string | null | undefined => {
    if (value === undefined) return undefined
    if (value === null) return null
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

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
            description,
            price,
            capacity,
            isPackage,
            packageDaysCount,
            validDays,
            sortOrder,
            isActive,
        } = body

        if (!eventId || !name || price === undefined || capacity === undefined) {
            return NextResponse.json(
                { success: false, error: "Faltan datos requeridos" },
                { status: 400 }
            )
        }

        const packageDays = normalizePackageDaysCount(packageDaysCount)
        const ticketType = await prisma.ticketType.create({
            data: {
                eventId,
                name,
                description: normalizeDescription(description),
                price: Number(price),
                capacity: Number(capacity),
                isPackage: Boolean(isPackage),
                packageDaysCount: Boolean(isPackage) ? packageDays : null,
                validDays: normalizeValidDays(validDays),
                sortOrder: sortOrder !== undefined ? Number(sortOrder) : 0,
                isActive: isActive === undefined ? true : Boolean(isActive),
            },
        })

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
            description,
            price,
            capacity,
            isPackage,
            packageDaysCount,
            validDays,
            sortOrder,
            isActive,
        } = body

        if (!id) {
            return NextResponse.json(
                { success: false, error: "ID requerido" },
                { status: 400 }
            )
        }

        const data: {
            name?: string
            description?: string | null
            price?: number
            capacity?: number
            isPackage?: boolean
            packageDaysCount?: number | null
            validDays?: Prisma.InputJsonValue
            sortOrder?: number
            isActive?: boolean
        } = {}

        if (name !== undefined) data.name = name
        if (description !== undefined) {
            data.description = normalizeDescription(description) ?? null
        }
        if (price !== undefined) data.price = Number(price)
        if (capacity !== undefined) data.capacity = Number(capacity)
        if (isPackage !== undefined) data.isPackage = Boolean(isPackage)
        if (sortOrder !== undefined) data.sortOrder = Number(sortOrder)
        if (isActive !== undefined) data.isActive = Boolean(isActive)
        if (validDays !== undefined) data.validDays = normalizeValidDays(validDays)

        if (packageDaysCount !== undefined || isPackage !== undefined) {
            const packageDays = normalizePackageDaysCount(packageDaysCount)
            const packageEnabled = isPackage !== undefined ? Boolean(isPackage) : undefined
            data.packageDaysCount = packageEnabled === false ? null : packageDays
        }

        const ticketType = await prisma.ticketType.update({
            where: { id },
            data,
        })

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

        const sold = await prisma.ticket.count({
            where: { ticketTypeId: id },
        })

        if (sold > 0) {
            await prisma.ticketType.update({
                where: { id },
                data: { isActive: false },
            })

            await invalidateTicketTypeCache(ticketType.eventId)

            return NextResponse.json({
                success: true,
                message: "Tipo de entrada desactivado (tiene ventas)",
            })
        }

        await prisma.ticketType.delete({
            where: { id },
        })

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
