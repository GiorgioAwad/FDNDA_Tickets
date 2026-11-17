import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { invalidateTicketTypeCache } from "@/lib/cache"
import {
    getMembershipSlotInventoryReport,
    MembershipSlotCapacityError,
    saveMembershipSlotCapacities,
    type MembershipSlotInventoryReport,
} from "@/lib/membership-slot-inventory"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

async function requireAdmin() {
    const user = await getCurrentUser()
    return user?.role === UserRole.ADMIN ? user : null
}

async function loadEventReports(eventId: string): Promise<MembershipSlotInventoryReport[]> {
    const types = await prisma.ticketType.findMany({
        where: { eventId, membershipScheduleKey: { not: null } },
        select: { id: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    })
    const reports = await Promise.all(types.map(type => getMembershipSlotInventoryReport(prisma, type.id)))
    return reports.filter((report): report is MembershipSlotInventoryReport => report !== null)
}

/** Planes del evento con cupo por franja: cupo, pagados y pendientes por horario. */
export async function GET(request: NextRequest) {
    try {
        if (!(await requireAdmin())) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const eventId = new URL(request.url).searchParams.get("eventId")?.trim() ?? ""
        if (!eventId) {
            return NextResponse.json({ success: false, error: "Falta el evento" }, { status: 400 })
        }
        return NextResponse.json({ success: true, data: { plans: await loadEventReports(eventId) } })
    } catch (error) {
        console.error("[membership-slot-capacities] GET", error)
        return NextResponse.json({ success: false, error: "No se pudieron cargar los cupos por horario" }, { status: 500 })
    }
}

/** Body: { ticketTypeId, capacities: { "<clave de franja>": number } } */
export async function PUT(request: NextRequest) {
    try {
        const admin = await requireAdmin()
        if (!admin) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const body = (await request.json().catch(() => null)) as { ticketTypeId?: unknown; capacities?: unknown } | null
        const ticketTypeId = typeof body?.ticketTypeId === "string" ? body.ticketTypeId.trim() : ""
        const capacities = body?.capacities
        if (!ticketTypeId || !capacities || typeof capacities !== "object" || Array.isArray(capacities)) {
            return NextResponse.json({ success: false, error: "Datos incompletos" }, { status: 400 })
        }
        const type = await prisma.ticketType.findUnique({ where: { id: ticketTypeId }, select: { eventId: true } })
        if (!type) {
            return NextResponse.json({ success: false, error: "Plan no encontrado" }, { status: 404 })
        }

        const result = await prisma.$transaction(tx =>
            saveMembershipSlotCapacities(tx, ticketTypeId, capacities as Record<string, unknown>)
        )
        console.info("[membership-slot-capacities] updated", {
            ticketTypeId,
            adminId: admin.id,
            ...result,
        })
        await invalidateTicketTypeCache(type.eventId, ticketTypeId)

        const report = await getMembershipSlotInventoryReport(prisma, ticketTypeId)
        return NextResponse.json({ success: true, data: { plan: report } })
    } catch (error) {
        if (error instanceof MembershipSlotCapacityError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 400 })
        }
        console.error("[membership-slot-capacities] PUT", error)
        return NextResponse.json({ success: false, error: "No se pudieron guardar los cupos" }, { status: 500 })
    }
}
