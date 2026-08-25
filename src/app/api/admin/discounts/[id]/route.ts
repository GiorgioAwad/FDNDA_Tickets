import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { parseLimaDateTimeInput } from "@/lib/discounts"
import { formatDateUTC } from "@/lib/qr"
import { parseDateOnly } from "@/lib/utils"

export const runtime = "nodejs"

// PUT - Actualizar código de descuento
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await params
        const body = await request.json()
        const {
            code,
            description,
            type,
            value,
            eventId,
            ticketTypeId,
            validDate,
            minPurchase,
            maxUses,
            maxUsesPerUser,
            validFrom,
            validUntil,
            isActive,
        } = body

        // Verificar que el código exista
        const existingCode = await prisma.discountCode.findUnique({
            where: { id },
        })

        if (!existingCode) {
            return NextResponse.json(
                { success: false, error: "Código no encontrado" },
                { status: 404 }
            )
        }

        const normalizedValue = value === undefined ? Number(existingCode.value) : Number(value)
        const normalizedType = type ?? existingCode.type
        if (
            (normalizedType !== "PERCENTAGE" && normalizedType !== "FIXED") ||
            !Number.isFinite(normalizedValue) ||
            normalizedValue <= 0 ||
            (normalizedType === "PERCENTAGE" && normalizedValue > 100)
        ) {
            return NextResponse.json(
                { success: false, error: "El valor del descuento no es válido" },
                { status: 400 }
            )
        }

        const nextEventId = eventId === undefined ? existingCode.eventId : eventId || null
        const nextTicketTypeId = ticketTypeId === undefined
            ? existingCode.ticketTypeId
            : ticketTypeId || null
        const nextValidDateKey = validDate === undefined
            ? (existingCode.validDate ? formatDateUTC(existingCode.validDate) : "")
            : (typeof validDate === "string" ? validDate : "")

        if ((nextTicketTypeId || nextValidDateKey) && !nextEventId) {
            return NextResponse.json(
                { success: false, error: "Selecciona un evento antes de limitar por entrada o día" },
                { status: 400 }
            )
        }

        const event = nextEventId
            ? await prisma.event.findUnique({
                where: { id: nextEventId },
                select: { startDate: true, endDate: true },
            })
            : null
        if (nextEventId && !event) {
            return NextResponse.json(
                { success: false, error: "Evento no encontrado" },
                { status: 400 }
            )
        }

        const ticketTypeRecord = nextTicketTypeId
            ? await prisma.ticketType.findUnique({
                where: { id: nextTicketTypeId },
                select: { eventId: true },
            })
            : null
        if (nextTicketTypeId && (!ticketTypeRecord || ticketTypeRecord.eventId !== nextEventId)) {
            return NextResponse.json(
                { success: false, error: "La entrada seleccionada no pertenece al evento" },
                { status: 400 }
            )
        }

        if (nextValidDateKey && !/^\d{4}-\d{2}-\d{2}$/.test(nextValidDateKey)) {
            return NextResponse.json(
                { success: false, error: "El día de aplicación no es válido" },
                { status: 400 }
            )
        }
        if (
            nextValidDateKey &&
            event &&
            (nextValidDateKey < formatDateUTC(event.startDate) || nextValidDateKey > formatDateUTC(event.endDate))
        ) {
            return NextResponse.json(
                { success: false, error: "El día debe estar dentro del rango del evento" },
                { status: 400 }
            )
        }

        let parsedValidFrom = existingCode.validFrom
        let parsedValidUntil = existingCode.validUntil
        try {
            if (validFrom !== undefined) {
                parsedValidFrom = validFrom ? parseLimaDateTimeInput(validFrom) : new Date()
            }
            if (validUntil !== undefined) {
                parsedValidUntil = validUntil
                    ? parseLimaDateTimeInput(validUntil, { endOfMinute: true })
                    : null
            }
        } catch {
            return NextResponse.json(
                { success: false, error: "Revisa la fecha y hora de vigencia (hora Lima)" },
                { status: 400 }
            )
        }
        if (parsedValidUntil && parsedValidUntil < parsedValidFrom) {
            return NextResponse.json(
                { success: false, error: "“Válido hasta” debe ser posterior a “Válido desde”" },
                { status: 400 }
            )
        }

        // Si cambia el código, verificar que no exista otro igual
        if (code && code.toUpperCase() !== existingCode.code) {
            const duplicateCode = await prisma.discountCode.findUnique({
                where: { code: code.toUpperCase() },
            })
            if (duplicateCode) {
                return NextResponse.json(
                    { success: false, error: "Este código ya existe" },
                    { status: 400 }
                )
            }
        }

        const discountCode = await prisma.discountCode.update({
            where: { id },
            data: {
                ...(code && { code: code.toUpperCase() }),
                ...(description !== undefined && { description }),
                ...(type && { type: normalizedType }),
                ...(value !== undefined && { value: normalizedValue }),
                ...(eventId !== undefined && { eventId: eventId || null }),
                ...(ticketTypeId !== undefined && { ticketTypeId: ticketTypeId || null }),
                ...(validDate !== undefined && {
                    validDate: nextValidDateKey ? parseDateOnly(nextValidDateKey) : null,
                }),
                ...(minPurchase !== undefined && { minPurchase: minPurchase || null }),
                ...(maxUses !== undefined && { maxUses: maxUses || null }),
                ...(maxUsesPerUser !== undefined && { maxUsesPerUser }),
                ...(validFrom !== undefined && { validFrom: parsedValidFrom }),
                ...(validUntil !== undefined && { validUntil: parsedValidUntil }),
                ...(isActive !== undefined && { isActive }),
            },
        })

        return NextResponse.json({ success: true, data: discountCode })
    } catch (error) {
        console.error("Error updating discount code:", error)
        return NextResponse.json({ success: false, error: "Error al actualizar código" }, { status: 500 })
    }
}

// DELETE - Eliminar código de descuento
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await params

        // Verificar que el código exista
        const existingCode = await prisma.discountCode.findUnique({
            where: { id },
            include: { _count: { select: { usages: true } } },
        })

        if (!existingCode) {
            return NextResponse.json(
                { success: false, error: "Código no encontrado" },
                { status: 404 }
            )
        }

        // Si tiene usos, solo desactivar en vez de eliminar
        if (existingCode._count.usages > 0) {
            await prisma.discountCode.update({
                where: { id },
                data: { isActive: false },
            })
            return NextResponse.json({ 
                success: true, 
                message: "Código desactivado (tiene historial de uso)" 
            })
        }

        // Si no tiene usos, eliminar
        await prisma.discountCode.delete({
            where: { id },
        })

        return NextResponse.json({ success: true, message: "Código eliminado" })
    } catch (error) {
        console.error("Error deleting discount code:", error)
        return NextResponse.json({ success: false, error: "Error al eliminar código" }, { status: 500 })
    }
}
