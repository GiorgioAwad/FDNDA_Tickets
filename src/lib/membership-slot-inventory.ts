import { Prisma } from "@prisma/client"
import { getMembershipScheduleProfile } from "@/lib/membership-schedule"
import { assertMembershipSlotCapacity } from "@/lib/membership-slot-capacity"

/** Call after writing the new reservation, inside the same transaction. */
export async function enforceMembershipSlotInventory(tx: Prisma.TransactionClient, ticketTypeId: string): Promise<void> {
    const type = await tx.ticketType.findUniqueOrThrow({
        where: { id: ticketTypeId },
        select: { membershipScheduleKey: true, event: { select: { servilexSucursalCode: true } } },
    })
    const profile = getMembershipScheduleProfile(type.event.servilexSucursalCode, type.membershipScheduleKey)
    if (!profile?.categories.some(c => c.frequencies.some(f => f.dayGroups.some(g => g.hours.some(h => h.capacity !== undefined))))) return

    // All writers of limited schedules share the plan row lock. At READ COMMITTED,
    // the following reads see reservations committed by the previous lock holder.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM ticket_types WHERE id = ${ticketTypeId} FOR UPDATE`)
    // One snapshot for both states: a payment completing between two separate
    // reads must not count the same student as both pending and paid.
    const rows = await tx.$queryRaw<Array<{ schedule: Prisma.JsonValue }>>(Prisma.sql`
        SELECT attendee->'membershipSchedule' AS schedule
        FROM order_items oi JOIN orders o ON o.id = oi."orderId"
        CROSS JOIN LATERAL jsonb_array_elements(
            CASE WHEN jsonb_typeof(oi."attendeeData") = 'array'
                THEN oi."attendeeData" ELSE '[null]'::jsonb END
        ) AS attendees(attendee)
        WHERE oi."ticketTypeId" = ${ticketTypeId} AND o.status = 'PENDING'
        UNION ALL
        SELECT t."membershipSchedule" AS schedule
        FROM tickets t JOIN orders o ON o.id = t."orderId"
        WHERE t."ticketTypeId" = ${ticketTypeId} AND t.status = 'ACTIVE' AND o.status = 'PAID'
    `)
    assertMembershipSlotCapacity(profile, rows.map(row => row.schedule))
}
