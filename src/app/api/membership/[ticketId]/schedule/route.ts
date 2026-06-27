import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { getTodayDateString } from "@/lib/qr"
import {
    getMembershipScheduleProfile,
    validateMembershipScheduleSelection,
} from "@/lib/membership-schedule"
import {
    isFixedTermMembership,
    getMembershipAnchor,
    getMembershipPeriod,
    getMembershipExpiry,
    type ScanTicket,
} from "@/lib/scan-helpers"

export const runtime = "nodejs"

// El alumno (o admin) fija el horario del PRÓXIMO mes de su membresía. El mes en
// curso es inmutable; si no fija nada, el escáner hereda el horario anterior
// (al final, el de checkout). Solo membresías a término fijo multi-mes
// (semestral/anual) BRONCE/PLATA con horario semanal.
export async function POST(
    request: NextRequest,
    context: { params: Promise<{ ticketId: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { ticketId } = await context.params
        const body = (await request.json().catch(() => null)) as
            | { schedule?: unknown; category?: unknown; frequency?: unknown; hours?: unknown }
            | null
        const input = (body && "schedule" in body ? body.schedule : body) ?? null

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                event: true,
                ticketType: true,
                entitlements: true,
                monthlySchedules: { select: { monthIndex: true, selection: true } },
                membershipFreeze: true,
            },
        })

        if (!ticket) {
            return NextResponse.json({ success: false, error: "Entrada no encontrada" }, { status: 404 })
        }
        if (ticket.userId !== user.id && !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
        }
        if (ticket.status !== "ACTIVE") {
            return NextResponse.json({ success: false, error: "La entrada no está activa" }, { status: 400 })
        }

        const scanTicket = ticket as unknown as ScanTicket

        // Elegibilidad: término fijo multi-mes (semestral/anual). Mensual (1) y ORO
        // (sin horario) quedan fuera.
        const duration = ticket.ticketType.membershipDurationMonths ?? 0
        if (!isFixedTermMembership(scanTicket) || duration <= 1) {
            return NextResponse.json(
                { success: false, error: "Esta membresía no permite cambiar el horario por mes." },
                { status: 400 }
            )
        }

        const profile = getMembershipScheduleProfile(
            ticket.event.servilexSucursalCode,
            ticket.ticketType.membershipScheduleKey
        )
        if (!profile) {
            return NextResponse.json(
                { success: false, error: "Esta membresía no tiene horario semanal configurado." },
                { status: 400 }
            )
        }

        const anchor = getMembershipAnchor(scanTicket)
        if (!anchor) {
            return NextResponse.json({ success: false, error: "Membresía sin fecha de inicio." }, { status: 400 })
        }

        // Mes objetivo = el próximo (índice del mes en curso + 1).
        const today = getTodayDateString()
        const period = getMembershipPeriod(today, anchor)
        const currentIndex = period?.index ?? 0
        const targetIndex = currentIndex + 1
        const targetStart = period?.endStr ?? null

        // No permitir fijar un mes fuera de la vigencia de la membresía.
        const freezeRanges = ticket.membershipFreeze
            ? [{
                  month: ticket.membershipFreeze.month,
                  startStr: ticket.membershipFreeze.startDate.toISOString().slice(0, 10),
                  endStr: ticket.membershipFreeze.endDate.toISOString().slice(0, 10),
              }]
            : []
        const expiryStr = getMembershipExpiry(anchor, duration, undefined, freezeRanges)
        if (targetStart && targetStart >= expiryStr) {
            return NextResponse.json(
                { success: false, error: "Tu membresía no tiene un mes siguiente disponible." },
                { status: 400 }
            )
        }

        // Validar la selección (frecuencia + hora) contra el perfil de la sede.
        const result = validateMembershipScheduleSelection(
            profile,
            input as Parameters<typeof validateMembershipScheduleSelection>[1],
            ticket.event.servilexSucursalCode || ""
        )
        if (!result.ok) {
            return NextResponse.json({ success: false, error: result.error }, { status: 400 })
        }

        await prisma.membershipMonthlySchedule.upsert({
            where: { ticketId_monthIndex: { ticketId: ticket.id, monthIndex: targetIndex } },
            create: {
                ticketId: ticket.id,
                monthIndex: targetIndex,
                selection: result.selection as unknown as Prisma.InputJsonValue,
            },
            update: { selection: result.selection as unknown as Prisma.InputJsonValue },
        })

        return NextResponse.json({
            success: true,
            data: { monthIndex: targetIndex, startsOn: targetStart, selection: result.selection },
        })
    } catch (error) {
        console.error("Membership schedule error:", error)
        return NextResponse.json({ success: false, error: "No se pudo guardar el horario" }, { status: 500 })
    }
}
