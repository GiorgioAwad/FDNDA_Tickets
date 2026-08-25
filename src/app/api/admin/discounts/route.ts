import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { parseLimaDateTimeInput } from "@/lib/discounts"
import { formatDateUTC } from "@/lib/qr"
import { parseDateOnly } from "@/lib/utils"

export const runtime = "nodejs"

// GET - Listar códigos de descuento
export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const raw = await prisma.discountCode.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                event: { select: { id: true, title: true } },
                ticketType: { select: { id: true, name: true } },
                _count: { select: { usages: true } },
            },
        })

        const discountCodes = raw.map((d) => ({
            ...d,
            value: Number(d.value),
            minPurchase: d.minPurchase ? Number(d.minPurchase) : null,
        }))

        return NextResponse.json({ success: true, data: discountCodes })
    } catch (error) {
        console.error("Error fetching discount codes:", error)
        return NextResponse.json({ success: false, error: "Error al obtener códigos" }, { status: 500 })
    }
}

// POST - Crear código de descuento
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const {
            code,
            description,
            type = "PERCENTAGE",
            value,
            eventId,
            ticketTypeId,
            validDate,
            minPurchase,
            maxUses,
            maxUsesPerUser = 1,
            validFrom,
            validUntil,
        } = body

        if (!code || value === undefined) {
            return NextResponse.json(
                { success: false, error: "Código y valor son requeridos" },
                { status: 400 }
            )
        }

        const normalizedValue = Number(value)
        if (
            (type !== "PERCENTAGE" && type !== "FIXED") ||
            !Number.isFinite(normalizedValue) ||
            normalizedValue <= 0 ||
            (type === "PERCENTAGE" && normalizedValue > 100)
        ) {
            return NextResponse.json(
                { success: false, error: "El valor del descuento no es válido" },
                { status: 400 }
            )
        }

        if ((ticketTypeId || validDate) && !eventId) {
            return NextResponse.json(
                { success: false, error: "Selecciona un evento antes de limitar por entrada o día" },
                { status: 400 }
            )
        }

        const event = eventId
            ? await prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, startDate: true, endDate: true },
            })
            : null
        if (eventId && !event) {
            return NextResponse.json(
                { success: false, error: "Evento no encontrado" },
                { status: 400 }
            )
        }

        const ticketType = ticketTypeId
            ? await prisma.ticketType.findUnique({
                where: { id: ticketTypeId },
                select: { eventId: true },
            })
            : null
        if (ticketTypeId && (!ticketType || ticketType.eventId !== eventId)) {
            return NextResponse.json(
                { success: false, error: "La entrada seleccionada no pertenece al evento" },
                { status: 400 }
            )
        }

        const validDateKey = typeof validDate === "string" ? validDate : ""
        if (validDateKey && !/^\d{4}-\d{2}-\d{2}$/.test(validDateKey)) {
            return NextResponse.json(
                { success: false, error: "El día de aplicación no es válido" },
                { status: 400 }
            )
        }
        if (
            validDateKey &&
            event &&
            (validDateKey < formatDateUTC(event.startDate) || validDateKey > formatDateUTC(event.endDate))
        ) {
            return NextResponse.json(
                { success: false, error: "El día debe estar dentro del rango del evento" },
                { status: 400 }
            )
        }

        let parsedValidFrom = new Date()
        let parsedValidUntil: Date | null = null
        try {
            if (validFrom) parsedValidFrom = parseLimaDateTimeInput(validFrom)
            if (validUntil) parsedValidUntil = parseLimaDateTimeInput(validUntil, { endOfMinute: true })
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

        // Verificar que el código no exista
        const existingCode = await prisma.discountCode.findUnique({
            where: { code: code.toUpperCase() },
        })

        if (existingCode) {
            return NextResponse.json(
                { success: false, error: "Este código ya existe" },
                { status: 400 }
            )
        }

        const discountCode = await prisma.discountCode.create({
            data: {
                code: code.toUpperCase(),
                description,
                type,
                value: normalizedValue,
                eventId: eventId || null,
                ticketTypeId: ticketTypeId || null,
                validDate: validDateKey ? parseDateOnly(validDateKey) : null,
                minPurchase: minPurchase || null,
                maxUses: maxUses || null,
                maxUsesPerUser,
                validFrom: parsedValidFrom,
                validUntil: parsedValidUntil,
                createdBy: user.id,
            },
        })

        return NextResponse.json({ success: true, data: discountCode })
    } catch (error) {
        console.error("Error creating discount code:", error)
        return NextResponse.json({ success: false, error: "Error al crear código" }, { status: 500 })
    }
}
