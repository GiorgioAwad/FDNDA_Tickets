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

/**
 * Error de negocio: bloqueos que aparecieron al replanificar dentro de la
 * transaccion, huella (fingerprint) desactualizada, o snapshot irreconstruible.
 * Se distingue por tipo (no por texto) de cualquier otro fallo -Prisma,
 * deadlock, timeout, JSON malformado- para que la ruta que llama pueda
 * devolver 409 con el mensaje real SOLO en este caso, y 500 generico (sin
 * filtrar el detalle interno) en cualquier otro.
 */
export class MembershipChangeAbort extends Error {
    constructor(message: string) {
        super(message)
        this.name = "MembershipChangeAbort"
    }
}

/**
 * Toma un lock de fila sobre el ticket ANTES de releer su estado dentro de la
 * transaccion. Sin este lock, dos "Aplicar" concurrentes sobre el mismo
 * carnet (un doble clic basta) pueden releer el mismo estado en READ
 * COMMITTED, pasar ambos la comparacion de huella, y aplicar el cambio dos
 * veces -en TRANSFER eso mueve el cupo dos veces con un solo carnet movido,
 * sin que las guardas de `sold`/capacidad lo detecten (cada una ve una fila
 * valida). Debe llamarse al inicio de la transaccion, antes de cualquier
 * lectura de negocio -lo reutilizan tanto el cambio de horario como el de
 * sede/tipo.
 */
export async function lockMembershipTicket(tx: Tx, ticketId: string): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "tickets" WHERE "id" = ${ticketId} FOR UPDATE`
    )
}

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
            throw new MembershipChangeAbort(
                "No se pudo descontar el cupo del tipo origen; el carnet no se movio."
            )
        }
    }
    if (writes.soldIncrementTypeId) {
        const incremented =
            plan.overCapacityOverride || writes.soldIncrementUsesDateCapacity
            ? await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                  UPDATE "ticket_types"
                  SET "sold" = "sold" + 1
                  WHERE "id" = ${writes.soldIncrementTypeId}
                    AND "isActive" = true
                  RETURNING "id"
              `)
            : await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                  UPDATE "ticket_types"
                  SET "sold" = "sold" + 1
                  WHERE "id" = ${writes.soldIncrementTypeId}
                    AND "isActive" = true
                    AND ("capacity" = 0 OR "sold" + 1 <= "capacity")
                  RETURNING "id"
              `)
        if (!incremented[0]) {
            throw new MembershipChangeAbort(
                "No se pudo reservar el cupo del tipo destino; el carnet no se movio."
            )
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
            reason: plan.overCapacityOverride
                ? `[SOBRECUPO AUTORIZADO] ${reason}`
                : reason,
            before: plan.before as unknown as Prisma.InputJsonValue,
            after: plan.after as unknown as Prisma.InputJsonValue,
        },
    })
}
