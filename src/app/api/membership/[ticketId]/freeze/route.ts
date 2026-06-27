import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { parseDateOnly } from "@/lib/utils"
import { formatDateUTC } from "@/lib/qr"
import {
    getEligibleMembershipFreezeMonths,
    getMembershipAnchor,
    getMembershipExpiry,
    validateMembershipFreezeMonth,
    type ScanTicket,
} from "@/lib/scan-helpers"

export const runtime = "nodejs"

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
        const body = (await request.json().catch(() => null)) as { month?: unknown } | null
        const month = typeof body?.month === "string" ? body.month.trim() : ""

        const ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: {
                event: true,
                ticketType: true,
                entitlements: true,
                membershipFreeze: true,
            },
        })

        if (!ticket) {
            return NextResponse.json({ success: false, error: "Entrada no encontrada" }, { status: 404 })
        }
        if (ticket.userId !== user.id && !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 403 })
        }

        const scanTicket = ticket as unknown as ScanTicket
        const validation = validateMembershipFreezeMonth(scanTicket, month)
        if (!validation.ok) {
            return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
        }

        const freeze = await prisma.membershipFreeze.create({
            data: {
                ticketId: ticket.id,
                month: validation.range.month,
                startDate: parseDateOnly(validation.range.startStr),
                endDate: parseDateOnly(validation.range.endStr),
            },
        })

        const anchor = getMembershipAnchor(scanTicket)
        const duration = ticket.ticketType.membershipDurationMonths ?? 0
        const membershipExpiry = anchor && duration > 0
            ? getMembershipExpiry(anchor, duration, undefined, [validation.range])
            : null

        return NextResponse.json({
            success: true,
            data: {
                freeze: {
                    month: freeze.month,
                    start: formatDateUTC(freeze.startDate),
                    end: formatDateUTC(freeze.endDate),
                    createdAt: freeze.createdAt.toISOString(),
                },
                membershipExpiry,
                availableMonths: getEligibleMembershipFreezeMonths(
                    { ...scanTicket, membershipFreeze: freeze },
                    new Date()
                ),
            },
        })
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return NextResponse.json(
                { success: false, error: "Esta membresía ya usó su congelamiento." },
                { status: 409 }
            )
        }
        console.error("Membership freeze error:", error)
        return NextResponse.json({ success: false, error: "No se pudo congelar la membresía" }, { status: 500 })
    }
}
