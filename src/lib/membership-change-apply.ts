/**
 * Ejecuta las escrituras de un plan de correccion de membresia dentro de una
 * transaccion, y deja el rastro en MembershipAdminChange.
 *
 * El plan ya viene validado y REPLANIFICADO dentro de la transaccion por el
 * llamador; aqui no se decide nada, solo se escribe.
 */
import { Prisma, type MembershipChangeKind } from "@prisma/client"

import type { MembershipChangePlan } from "@/lib/membership-transfer"

type Tx = Prisma.TransactionClient

export async function applyMembershipChange(
    tx: Tx,
    args: {
        plan: Extract<MembershipChangePlan, { ok: true }>
        ticketId: string
        orderItemId: string
        actorId: string
        reason: string
    }
) {
    const { plan, ticketId, orderItemId, actorId, reason } = args
    const { writes } = plan

    // El cupo se mueve con guardas en el propio UPDATE: si otro proceso vendio
    // el ultimo lugar entremedio, la fila no se actualiza y se aborta.
    if (writes.soldDecrementTypeId) {
        const decremented = await tx.ticketType.updateMany({
            where: { id: writes.soldDecrementTypeId, sold: { gt: 0 } },
            data: { sold: { decrement: 1 } },
        })
        if (decremented.count !== 1) {
            throw new Error("No se pudo descontar el cupo del tipo origen; el carnet no se movio.")
        }
    }
    if (writes.soldIncrementTypeId) {
        const incremented = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            UPDATE "ticket_types"
            SET "sold" = "sold" + 1
            WHERE "id" = ${writes.soldIncrementTypeId}
              AND "isActive" = true
              AND ("capacity" = 0 OR "sold" + 1 <= "capacity")
            RETURNING "id"
        `)
        if (!incremented[0]) {
            throw new Error("No se pudo reservar el cupo del tipo destino; el carnet no se movio.")
        }
    }

    const ticketData: Prisma.TicketUpdateInput = {}
    if (writes.ticket.eventId) ticketData.event = { connect: { id: writes.ticket.eventId } }
    if (writes.ticket.ticketTypeId) {
        ticketData.ticketType = { connect: { id: writes.ticket.ticketTypeId } }
    }
    if (writes.ticket.membershipSchedule) {
        ticketData.membershipSchedule =
            writes.ticket.membershipSchedule as unknown as Prisma.InputJsonValue
    }
    if (Object.keys(ticketData).length > 0) {
        await tx.ticket.update({ where: { id: ticketId }, data: ticketData })
    }

    const itemData: Prisma.OrderItemUpdateInput = {}
    if (writes.orderItem.ticketTypeId) {
        itemData.ticketType = { connect: { id: writes.orderItem.ticketTypeId } }
    }
    if (writes.orderItem.attendeeData) {
        itemData.attendeeData = writes.orderItem.attendeeData as unknown as Prisma.InputJsonValue
    }
    if (Object.keys(itemData).length > 0) {
        await tx.orderItem.update({ where: { id: orderItemId }, data: itemData })
    }

    await tx.membershipAdminChange.create({
        data: {
            ticketId,
            actorId,
            kind: plan.kind as MembershipChangeKind,
            reason,
            before: plan.before as unknown as Prisma.InputJsonValue,
            after: plan.after as unknown as Prisma.InputJsonValue,
        },
    })
}
