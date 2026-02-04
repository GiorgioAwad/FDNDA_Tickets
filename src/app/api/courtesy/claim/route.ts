import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import crypto from "crypto"

export const runtime = "nodejs"

// Generar código único para el ticket
function generateTicketCode(): string {
    return crypto.randomBytes(8).toString("hex").toUpperCase()
}

// POST - Canjear código de cortesía
export async function POST(request: NextRequest) {
    try {
        const session = await auth()
        
        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Debes iniciar sesión para canjear tu cortesía" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const { code, attendeeName, attendeeDni } = body

        if (!code) {
            return NextResponse.json(
                { success: false, error: "Código requerido" },
                { status: 400 }
            )
        }

        // Buscar el código de cortesía
        const courtesyTicket = await prisma.courtesyTicket.findUnique({
            where: { claimCode: code.toUpperCase() },
            include: {
                batch: {
                    include: {
                        event: true,
                        ticketType: true,
                    },
                },
                ticket: true,
            },
        })

        if (!courtesyTicket) {
            return NextResponse.json(
                { success: false, error: "Código no válido" },
                { status: 404 }
            )
        }

        if (courtesyTicket.status !== "PENDING") {
            return NextResponse.json(
                { success: false, error: "Este código ya fue canjeado" },
                { status: 400 }
            )
        }

        if (courtesyTicket.expiresAt && new Date() > courtesyTicket.expiresAt) {
            return NextResponse.json(
                { success: false, error: "Este código ha expirado" },
                { status: 400 }
            )
        }

        // Determinar datos del asistente:
        // Si hay datos pre-asignados, usarlos; si no, usar los proporcionados
        const finalAttendeeName = courtesyTicket.assignedName || attendeeName
        const finalAttendeeDni = courtesyTicket.assignedDni || attendeeDni

        if (!finalAttendeeName || !finalAttendeeDni) {
            return NextResponse.json(
                { success: false, error: "Nombre y DNI son requeridos" },
                { status: 400 }
            )
        }

        // Crear una orden de cortesía y el ticket en una transacción
        const result = await prisma.$transaction(async (tx) => {
            // Crear una orden especial para cortesías (con monto 0)
            const courtesyOrder = await tx.order.create({
                data: {
                    userId: session.user.id,
                    status: "PAID",
                    totalAmount: 0,
                    currency: "PEN",
                    provider: "COURTESY",
                },
            })

            // Crear el ticket
            const ticket = await tx.ticket.create({
                data: {
                    orderId: courtesyOrder.id,
                    eventId: courtesyTicket.batch.eventId,
                    ticketTypeId: courtesyTicket.batch.ticketTypeId,
                    userId: session.user.id,
                    status: "ACTIVE",
                    attendeeName: finalAttendeeName,
                    attendeeDni: finalAttendeeDni,
                    ticketCode: generateTicketCode(),
                },
                include: {
                    event: true,
                    ticketType: true,
                },
            })

            // Actualizar la cortesía
            await tx.courtesyTicket.update({
                where: { id: courtesyTicket.id },
                data: {
                    status: "CLAIMED",
                    claimedByUserId: session.user.id,
                    claimedAt: new Date(),
                    ticketId: ticket.id,
                },
            })

            return ticket
        })

        return NextResponse.json({
            success: true,
            message: "¡Cortesía canjeada exitosamente!",
            data: {
                ticketId: result.id,
                eventTitle: result.event.title,
                ticketType: result.ticketType.name,
                attendeeName: result.attendeeName,
                attendeeDni: result.attendeeDni,
            },
        })
    } catch (error) {
        console.error("Error claiming courtesy ticket:", error)
        return NextResponse.json(
            { success: false, error: "Error al canjear cortesía" },
            { status: 500 }
        )
    }
}

// GET - Verificar un código sin canjearlo
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const code = searchParams.get("code")

        if (!code) {
            return NextResponse.json(
                { success: false, error: "Código requerido" },
                { status: 400 }
            )
        }

        const courtesyTicket = await prisma.courtesyTicket.findUnique({
            where: { claimCode: code.toUpperCase() },
            include: {
                batch: {
                    include: {
                        event: { select: { id: true, title: true, startDate: true, venue: true } },
                        ticketType: { select: { name: true } },
                    },
                },
            },
        })

        if (!courtesyTicket) {
            return NextResponse.json({ valid: false, error: "Código no válido" })
        }

        if (courtesyTicket.status !== "PENDING") {
            return NextResponse.json({ valid: false, error: "Este código ya fue canjeado" })
        }

        if (courtesyTicket.expiresAt && new Date() > courtesyTicket.expiresAt) {
            return NextResponse.json({ valid: false, error: "Este código ha expirado" })
        }

        return NextResponse.json({
            valid: true,
            data: {
                event: courtesyTicket.batch.event,
                ticketType: courtesyTicket.batch.ticketType.name,
                hasAssignedAttendee: !!(courtesyTicket.assignedName && courtesyTicket.assignedDni),
                assignedName: courtesyTicket.assignedName,
                // No mostrar el DNI completo por privacidad
                assignedDniMasked: courtesyTicket.assignedDni 
                    ? `****${courtesyTicket.assignedDni.slice(-4)}` 
                    : null,
            },
        })
    } catch (error) {
        console.error("Error verifying courtesy code:", error)
        return NextResponse.json({ valid: false, error: "Error al verificar código" }, { status: 500 })
    }
}
