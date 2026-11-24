import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { planAdminMembershipFreeze } from "@/lib/admin-membership-freeze"
import { getMembershipFreezeMonthRange, type ScanTicket } from "@/lib/scan-helpers"
import { parseDateOnly } from "@/lib/utils"

export const runtime = "nodejs"

export async function POST(request: NextRequest, context: { params: Promise<{ ticketId: string }> }) {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    if (!hasRole(user.role, "ADMIN")) return NextResponse.json({ success: false, error: "Solo administración puede forzar congelamientos." }, { status: 403 })
    const body = await request.json().catch(() => null)
    const reason = typeof body?.reason === "string" ? body.reason.trim() : ""
    if (reason.length < 5 || reason.length > 1000) {
        return NextResponse.json({ success: false, error: "Indica un motivo de entre 5 y 1000 caracteres." }, { status: 400 })
    }
    const { ticketId } = await context.params
    try {
        const result = await prisma.$transaction(async (tx) => {
            // Serialize admin requests and the self-service insert for this ticket.
            const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM tickets WHERE id = ${ticketId} FOR UPDATE`
            if (!locked.length) return { status: 404, error: "Membresía no encontrada." }
            const ticket = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: {
                event: true, ticketType: true, membershipFreeze: true, entitlements: true,
            } })
            let plan
            try { plan = planAdminMembershipFreeze(ticket as unknown as ScanTicket, body?.months) }
            catch (error) { return { status: 400, error: (error as Error).message } }
            if (plan.added.length === 0) return { status: 200, data: plan }
            const previous = ticket.membershipFreeze
            const history = Array.isArray(previous?.adminHistory) ? previous.adminHistory : []
            const adminHistory = [...history, {
                months: plan.added, reason, actorId: user.id, actorEmail: user.email,
                createdAt: new Date().toISOString(),
            }] as Prisma.InputJsonValue
            if (previous) {
                await tx.membershipFreeze.update({ where: { ticketId }, data: {
                    additionalMonths: [...new Set([...previous.additionalMonths, ...plan.added])].sort(), adminHistory,
                } })
            } else {
                const [month, ...additionalMonths] = plan.added
                const range = getMembershipFreezeMonthRange(month)!
                await tx.membershipFreeze.create({ data: {
                    ticketId, month, additionalMonths, adminHistory,
                    startDate: parseDateOnly(range.startStr), endDate: parseDateOnly(range.endStr),
                } })
            }
            return { status: 200, data: plan }
        })
        return NextResponse.json({ success: result.status === 200, ...result }, { status: result.status })
    } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
            return NextResponse.json({ success: false, error: "El congelamiento cambió. Actualiza la ficha y vuelve a intentarlo." }, { status: 409 })
        }
        console.error("Admin membership freeze error:", error)
        return NextResponse.json({ success: false, error: "No se pudo guardar el congelamiento." }, { status: 500 })
    }
}
