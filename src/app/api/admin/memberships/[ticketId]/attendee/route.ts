import { NextRequest, NextResponse } from "next/server"
import { Prisma, UserRole } from "@prisma/client"

import { getCurrentUser } from "@/lib/auth"
import { invalidateUserCache } from "@/lib/cache"
import { lockMembershipTicket, MembershipChangeAbort } from "@/lib/membership-change-apply"
import {
    ATTENDEE_NAME_CHANGE_FIELD,
    AttendeeRenameError,
    normalizeAttendeeNameInput,
    planAttendeeRename,
} from "@/lib/membership-attendee-rename"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type Db = Pick<Prisma.TransactionClient, "ticket">

function loadTicket(db: Db, ticketId: string) {
    return db.ticket.findUnique({
        where: { id: ticketId },
        select: {
            id: true,
            userId: true,
            status: true,
            attendeeName: true,
            attendeeDni: true,
            ticketTypeId: true,
            ticketType: { select: { name: true, event: { select: { servilexSucursalCode: true } } } },
            order: {
                select: {
                    status: true,
                    orderItems: { select: { id: true, ticketTypeId: true, attendeeData: true } },
                },
            },
        },
    })
}

/**
 * Cambia el nombre del asistente de un carnet (Ticket.attendeeName + su entrada en
 * OrderItem.attendeeData). DNI, matrícula, horario y comprobante no cambian. Queda
 * en el historial (membership_admin_changes, kind SCHEDULE con field ATTENDEE_NAME:
 * no requiere migración del enum).
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== UserRole.ADMIN) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }
        const { ticketId } = await params
        const body = (await request.json().catch(() => null)) as {
            firstName?: string
            secondName?: string
            lastNamePaternal?: string
            lastNameMaternal?: string
            expectedCurrentName?: string | null
            reason?: string
        } | null
        const reason = body?.reason?.trim() ?? ""
        if (reason.length < 5) {
            return NextResponse.json(
                { success: false, error: "Indica el motivo del cambio (mínimo 5 caracteres)." },
                { status: 400 }
            )
        }
        const name = normalizeAttendeeNameInput(body)

        const result = await prisma.$transaction(async (tx) => {
            await lockMembershipTicket(tx, ticketId)
            const ticket = await loadTicket(tx, ticketId)
            if (!ticket) throw new MembershipChangeAbort("Carnet no encontrado")
            if ((body?.expectedCurrentName ?? null) !== ticket.attendeeName) {
                throw new MembershipChangeAbort("El nombre del carnet cambió desde que abriste la ficha. Recarga y vuelve a intentarlo.")
            }
            const items = ticket.order.orderItems.filter((item) => item.ticketTypeId === ticket.ticketTypeId)
            if (items.length !== 1) {
                throw new MembershipChangeAbort("No se pudo identificar el detalle de compra de este carnet sin ambigüedad.")
            }
            const plan = planAttendeeRename({
                ticket,
                orderStatus: ticket.order.status,
                attendeeData: items[0].attendeeData,
                name,
            })
            const summary = {
                field: ATTENDEE_NAME_CHANGE_FIELD,
                ticketTypeName: ticket.ticketType.name,
                sucursalCode: ticket.ticketType.event.servilexSucursalCode,
            }
            await tx.ticket.update({ where: { id: ticketId }, data: { attendeeName: plan.afterName } })
            await tx.orderItem.update({
                where: { id: items[0].id },
                data: { attendeeData: plan.attendeeData as Prisma.InputJsonValue },
            })
            await tx.membershipAdminChange.create({
                data: {
                    ticketId,
                    actorId: user.id,
                    kind: "SCHEDULE",
                    reason,
                    before: { ...summary, scheduleSummary: plan.beforeName },
                    after: { ...summary, scheduleSummary: plan.afterName },
                },
            })
            return { userId: ticket.userId, beforeName: plan.beforeName, afterName: plan.afterName }
        })

        await invalidateUserCache(result.userId).catch(() => {})
        return NextResponse.json({ success: true, data: { beforeName: result.beforeName, afterName: result.afterName } })
    } catch (error) {
        if (error instanceof MembershipChangeAbort || error instanceof AttendeeRenameError) {
            return NextResponse.json({ success: false, error: error.message }, { status: 409 })
        }
        console.error("Error al cambiar el nombre del asistente:", error)
        return NextResponse.json({ success: false, error: "Error interno" }, { status: 500 })
    }
}
