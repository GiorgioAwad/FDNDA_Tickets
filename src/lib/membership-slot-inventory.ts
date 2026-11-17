import { Prisma } from "@prisma/client"
import { getMembershipScheduleProfile } from "@/lib/membership-schedule"
import {
    applySlotCapacityOverrides,
    assertMembershipSlotCapacity,
    countMembershipSlotReservations,
    listMembershipLimitedSlots,
    MAX_MEMBERSHIP_SLOT_CAPACITY,
    parseSlotCapacityOverrides,
    profileHasSlotCapacity,
} from "@/lib/membership-slot-capacity"

type SlotDb = Pick<Prisma.TransactionClient, "$queryRaw" | "ticketType">

async function loadLimitedProfile(db: SlotDb, ticketTypeId: string) {
    const type = await db.ticketType.findUniqueOrThrow({
        where: { id: ticketTypeId },
        select: {
            id: true,
            name: true,
            capacity: true,
            sold: true,
            isActive: true,
            membershipScheduleKey: true,
            membershipSlotCapacities: true,
            event: { select: { servilexSucursalCode: true } },
        },
    })
    const baseProfile = getMembershipScheduleProfile(type.event.servilexSucursalCode, type.membershipScheduleKey)
    if (!profileHasSlotCapacity(baseProfile)) return null
    return { type, baseProfile, profile: applySlotCapacityOverrides(baseProfile, type.membershipSlotCapacities) }
}

// One snapshot for both states: a payment completing between two separate
// reads must not count the same student as both pending and paid.
function readReservedSchedules(db: SlotDb, ticketTypeId: string) {
    return db.$queryRaw<Array<{ schedule: Prisma.JsonValue; paid: boolean }>>(Prisma.sql`
        SELECT attendee->'membershipSchedule' AS schedule, false AS paid
        FROM order_items oi JOIN orders o ON o.id = oi."orderId"
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(oi."attendeeData") = 'array'
                THEN oi."attendeeData" ELSE '[null]'::jsonb END
        ) AS attendees(attendee)
        WHERE oi."ticketTypeId" = ${ticketTypeId} AND o.status = 'PENDING'
        UNION ALL
        SELECT t."membershipSchedule" AS schedule, true AS paid
        FROM tickets t JOIN orders o ON o.id = t."orderId"
        WHERE t."ticketTypeId" = ${ticketTypeId} AND t.status = 'ACTIVE' AND o.status = 'PAID'
    `)
}

/** Call after writing the new reservation, inside the same transaction. */
export async function enforceMembershipSlotInventory(tx: Prisma.TransactionClient, ticketTypeId: string): Promise<void> {
    const loaded = await loadLimitedProfile(tx, ticketTypeId)
    if (!loaded) return

    // All writers of limited schedules share the plan row lock. At READ COMMITTED,
    // the following reads see reservations committed by the previous lock holder.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ticket_types WHERE id = ${ticketTypeId} FOR UPDATE`)
    // Re-read the overrides under the lock: an admin edit may have committed meanwhile.
    const locked = await loadLimitedProfile(tx, ticketTypeId)
    if (!locked) return
    const rows = await readReservedSchedules(tx, ticketTypeId)
    assertMembershipSlotCapacity(locked.profile, rows.map(row => row.schedule))
}

export interface MembershipSlotInventoryRow {
    key: string
    category: string
    categoryLabel: string
    frequencyLabel: string
    groupLabel: string
    start: string
    end: string
    defaultCapacity: number
    capacity: number
    /** Carnets pagados y activos. */
    paid: number
    /** Órdenes PENDING que retienen la franja mientras se paga. */
    pending: number
    available: number
}

export interface MembershipSlotInventoryReport {
    ticketTypeId: string
    name: string
    isActive: boolean
    planCapacity: number
    planSold: number
    slots: MembershipSlotInventoryRow[]
    /** Reservas cuyo horario no valida contra el catálogo (deberían ser 0). */
    invalidPaid: number
    invalidPending: number
}

/** Ocupación por franja (pagados + pendientes) para el admin. null si el plan no tiene cupo por franja. */
export async function getMembershipSlotInventoryReport(db: SlotDb, ticketTypeId: string): Promise<MembershipSlotInventoryReport | null> {
    const loaded = await loadLimitedProfile(db, ticketTypeId)
    if (!loaded) return null
    const rows = await readReservedSchedules(db, ticketTypeId)
    const paid = countMembershipSlotReservations(loaded.profile, rows.filter(r => r.paid).map(r => r.schedule))
    const pending = countMembershipSlotReservations(loaded.profile, rows.filter(r => !r.paid).map(r => r.schedule))
    return {
        ticketTypeId: loaded.type.id,
        name: loaded.type.name,
        isActive: loaded.type.isActive,
        planCapacity: loaded.type.capacity,
        planSold: loaded.type.sold,
        invalidPaid: paid.invalid,
        invalidPending: pending.invalid,
        slots: listMembershipLimitedSlots(loaded.baseProfile, loaded.type.membershipSlotCapacities).map(slot => {
            const paidCount = paid.occupancy.get(slot.key) ?? 0
            const pendingCount = pending.occupancy.get(slot.key) ?? 0
            return {
                key: slot.key,
                category: slot.category,
                categoryLabel: slot.categoryLabel,
                frequencyLabel: slot.frequencyLabel,
                groupLabel: slot.groupLabel,
                start: slot.start,
                end: slot.end,
                defaultCapacity: slot.defaultCapacity,
                capacity: slot.capacity,
                paid: paidCount,
                pending: pendingCount,
                available: Math.max(slot.capacity - paidCount - pendingCount, 0),
            }
        }),
    }
}

export class MembershipSlotCapacityError extends Error {}

/**
 * Guarda los cupos por franja editados por el admin (dentro de una transacción).
 * - Solo franjas que ya tienen cupo en el catálogo.
 * - Nunca por debajo de lo reservado (pagados + pendientes): una franja sobre su
 *   tope hace fallar TODAS las ventas del plan (assertMembershipSlotCapacity).
 * - Si el plan tiene tope global (capacity > 0), se ajusta a la suma de franjas.
 */
export async function saveMembershipSlotCapacities(
    tx: Prisma.TransactionClient,
    ticketTypeId: string,
    input: Record<string, unknown>
): Promise<{ before: Record<string, number>; after: Record<string, number>; planCapacityBefore: number; planCapacityAfter: number }> {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ticket_types WHERE id = ${ticketTypeId} FOR UPDATE`)
    const loaded = await loadLimitedProfile(tx, ticketTypeId)
    if (!loaded) throw new MembershipSlotCapacityError("Este plan no tiene cupos por horario.")

    const slots = listMembershipLimitedSlots(loaded.baseProfile, loaded.type.membershipSlotCapacities)
    const byKey = new Map(slots.map(slot => [slot.key, slot]))
    const effective = new Map(slots.map(slot => [slot.key, slot.capacity]))
    for (const [key, value] of Object.entries(input)) {
        const slot = byKey.get(key)
        if (!slot) throw new MembershipSlotCapacityError("Horario no reconocido para este plan.")
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_MEMBERSHIP_SLOT_CAPACITY) {
            throw new MembershipSlotCapacityError(`Cupo inválido para ${slot.start}–${slot.end}: usa un número entero entre 0 y ${MAX_MEMBERSHIP_SLOT_CAPACITY}.`)
        }
        effective.set(key, value)
    }

    const rows = await readReservedSchedules(tx, ticketTypeId)
    const { occupancy } = countMembershipSlotReservations(loaded.profile, rows.map(r => r.schedule))
    for (const slot of slots) {
        const reserved = occupancy.get(slot.key) ?? 0
        const next = effective.get(slot.key)!
        if (next < reserved) {
            throw new MembershipSlotCapacityError(
                `No puedes dejar ${slot.start}–${slot.end} (${slot.categoryLabel}) en ${next}: ya tiene ${reserved} reservados entre pagados y pendientes.`
            )
        }
    }

    const after: Record<string, number> = {}
    for (const slot of slots) {
        const next = effective.get(slot.key)!
        if (next !== slot.defaultCapacity) after[slot.key] = next
    }
    const total = [...effective.values()].reduce((sum, n) => sum + n, 0)
    const planCapacityBefore = loaded.type.capacity
    const planCapacityAfter = planCapacityBefore > 0 ? total : 0
    if (planCapacityAfter > 0 && planCapacityAfter < loaded.type.sold) {
        throw new MembershipSlotCapacityError(`La suma de cupos (${total}) queda por debajo de lo ya vendido en el plan (${loaded.type.sold}).`)
    }

    await tx.ticketType.update({
        where: { id: ticketTypeId },
        data: {
            membershipSlotCapacities: Object.keys(after).length > 0 ? after : Prisma.DbNull,
            capacity: planCapacityAfter,
        },
    })
    // Última red: con los cupos nuevos, las reservas actuales deben seguir cabiendo.
    assertMembershipSlotCapacity(applySlotCapacityOverrides(loaded.baseProfile, after), rows.map(r => r.schedule))
    return {
        before: parseSlotCapacityOverrides(loaded.type.membershipSlotCapacities),
        after,
        planCapacityBefore,
        planCapacityAfter,
    }
}
