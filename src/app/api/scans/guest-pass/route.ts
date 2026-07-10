import { Prisma } from "@prisma/client"
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser, hasRole } from "@/lib/auth"
import {
    GOLD_MEMBERSHIP_GUEST_PASS_LIMIT,
    buildMembershipGuestPassSummary,
    isGoldMembershipDisplay,
} from "@/lib/membership-guest-pass"
import { prisma } from "@/lib/prisma"
import { getTodayDateString } from "@/lib/qr"
import {
    type ScanTicket,
    buildMembershipDisplay,
    getMembershipAccessStatus,
    isFixedTermMembership,
} from "@/lib/scan-helpers"

export const runtime = "nodejs"

const membershipAccessMessage = (status: string): string => {
    if (status === "BLACKOUT") return "La membresía no está vigente durante enero y febrero."
    if (status === "FROZEN") return "La membresía está congelada actualmente."
    if (status === "NOT_STARTED") return "La membresía todavía no ha iniciado."
    if (status === "EXPIRED") return "La membresía ya venció."
    return "La membresía no está vigente."
}

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "STAFF")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const body = await request.json()
        const ticketId = typeof body.ticketId === "string" ? body.ticketId.trim() : ""
        const eventId = typeof body.eventId === "string" ? body.eventId.trim() : ""

        if (!ticketId || !eventId) {
            return NextResponse.json(
                { success: false, error: "Ticket y evento requeridos" },
                { status: 400 }
            )
        }

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                event: true,
                ticketType: true,
                entitlements: true,
                monthlySchedules: true,
                membershipFreeze: true,
            },
        })

        if (!ticket || ticket.eventId !== eventId) {
            return NextResponse.json(
                { success: false, error: "Membresía no encontrada para este evento" },
                { status: 404 }
            )
        }

        if (ticket.status !== "ACTIVE") {
            return NextResponse.json(
                { success: false, error: "La membresía no está activa" },
                { status: 409 }
            )
        }

        const today = getTodayDateString()
        const scanTicket = ticket as unknown as ScanTicket
        const display = buildMembershipDisplay(scanTicket, today)

        if (!isGoldMembershipDisplay(display)) {
            return NextResponse.json(
                { success: false, error: "Los pases gratis solo aplican a membresías ORO" },
                { status: 403 }
            )
        }

        if (isFixedTermMembership(scanTicket)) {
            const access = getMembershipAccessStatus(scanTicket, today)
            if (access.status !== "OK") {
                return NextResponse.json(
                    { success: false, error: membershipAccessMessage(access.status) },
                    { status: 409 }
                )
            }
        }

        const date = new Date(`${today}T12:00:00Z`)
        let registeredNumber: number | null = null

        // Cada intento toma uno de los tres slots protegidos por el índice único
        // (ticketId, number). Si otro staff ganó el slot, se prueba el siguiente.
        for (let number = 1; number <= GOLD_MEMBERSHIP_GUEST_PASS_LIMIT; number += 1) {
            try {
                await prisma.membershipGuestPass.create({
                    data: {
                        ticketId: ticket.id,
                        staffId: user.id,
                        eventId,
                        number,
                        date,
                    },
                })
                registeredNumber = number
                break
            } catch (error) {
                if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                    continue
                }
                throw error
            }
        }

        const used = await prisma.membershipGuestPass.count({ where: { ticketId: ticket.id } })
        const guestPasses = buildMembershipGuestPassSummary(used)

        if (registeredNumber === null) {
            return NextResponse.json(
                {
                    success: false,
                    error: "La membresía ya utilizó sus 3 pases gratis",
                    guestPasses,
                },
                { status: 409 }
            )
        }

        return NextResponse.json({
            success: true,
            message: `Pase gratis ${registeredNumber} de ${GOLD_MEMBERSHIP_GUEST_PASS_LIMIT} registrado`,
            guestPasses,
        })
    } catch (error) {
        console.error("Membership guest pass error:", error)
        return NextResponse.json(
            { success: false, error: "No se pudo registrar el pase gratis" },
            { status: 500 }
        )
    }
}
