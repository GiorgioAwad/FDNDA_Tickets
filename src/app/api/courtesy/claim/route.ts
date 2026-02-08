import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { auth } from "@/lib/auth"
import crypto from "crypto"

export const runtime = "nodejs"

function generateTicketCode(): string {
    return crypto.randomBytes(8).toString("hex").toUpperCase()
}

export async function POST(request: NextRequest) {
    try {
        const session = await auth()

        if (!session?.user) {
            return NextResponse.json(
                { success: false, error: "Debes iniciar sesion para canjear tu cortesia" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const { code, attendeeName, attendeeDni } = body

        if (!code) {
            return NextResponse.json(
                { success: false, error: "Codigo requerido" },
                { status: 400 }
            )
        }

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
                { success: false, error: "Codigo no valido" },
                { status: 404 }
            )
        }

        if (courtesyTicket.status !== "PENDING") {
            return NextResponse.json(
                { success: false, error: "Este codigo ya fue canjeado" },
                { status: 400 }
            )
        }

        if (courtesyTicket.expiresAt && new Date() > courtesyTicket.expiresAt) {
            return NextResponse.json(
                { success: false, error: "Este codigo ha expirado" },
                { status: 400 }
            )
        }

        const finalAttendeeName = courtesyTicket.assignedName || attendeeName
        const finalAttendeeDni = courtesyTicket.assignedDni || attendeeDni

        if (!finalAttendeeName || !finalAttendeeDni) {
            return NextResponse.json(
                { success: false, error: "Nombre y DNI son requeridos" },
                { status: 400 }
            )
        }

        const result = await prisma.$transaction(async (tx) => {
            const now = new Date()

            const claimed = await tx.courtesyTicket.updateMany({
                where: {
                    id: courtesyTicket.id,
                    status: "PENDING",
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: now } },
                    ],
                },
                data: {
                    status: "CLAIMED",
                    claimedByUserId: session.user.id,
                    claimedAt: now,
                },
            })

            if (claimed.count === 0) {
                throw new Error("Este codigo ya fue canjeado o expiro")
            }

            const stockReservation = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "ticket_types"
                SET "sold" = "sold" + 1
                WHERE "id" = ${courtesyTicket.batch.ticketTypeId}
                  AND "isActive" = true
                  AND ("capacity" = 0 OR "sold" + 1 <= "capacity")
                RETURNING "id"
            `)

            if (!stockReservation[0]) {
                throw new Error("No hay stock disponible para este tipo de entrada")
            }

            const courtesyOrder = await tx.order.create({
                data: {
                    userId: session.user.id,
                    status: "PAID",
                    totalAmount: 0,
                    currency: "PEN",
                    provider: "COURTESY",
                },
            })

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

            await tx.courtesyTicket.update({
                where: { id: courtesyTicket.id },
                data: {
                    ticketId: ticket.id,
                },
            })

            return ticket
        })

        return NextResponse.json({
            success: true,
            message: "Cortesia canjeada exitosamente",
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
            { success: false, error: (error as Error).message || "Error al canjear cortesia" },
            { status: 500 }
        )
    }
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const code = searchParams.get("code")

        if (!code) {
            return NextResponse.json(
                { success: false, error: "Codigo requerido" },
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
            return NextResponse.json({ valid: false, error: "Codigo no valido" })
        }

        if (courtesyTicket.status !== "PENDING") {
            return NextResponse.json({ valid: false, error: "Este codigo ya fue canjeado" })
        }

        if (courtesyTicket.expiresAt && new Date() > courtesyTicket.expiresAt) {
            return NextResponse.json({ valid: false, error: "Este codigo ha expirado" })
        }

        return NextResponse.json({
            valid: true,
            data: {
                event: courtesyTicket.batch.event,
                ticketType: courtesyTicket.batch.ticketType.name,
                hasAssignedAttendee: !!(courtesyTicket.assignedName && courtesyTicket.assignedDni),
                assignedName: courtesyTicket.assignedName,
                assignedDniMasked: courtesyTicket.assignedDni
                    ? `****${courtesyTicket.assignedDni.slice(-4)}`
                    : null,
            },
        })
    } catch (error) {
        console.error("Error verifying courtesy code:", error)
        return NextResponse.json({ valid: false, error: "Error al verificar codigo" }, { status: 500 })
    }
}
