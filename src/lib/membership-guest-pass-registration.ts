import { Prisma, type PrismaClient } from "@prisma/client"
import {
    GOLD_MEMBERSHIP_GUEST_PASS_LIMIT,
    buildMembershipGuestPassSummary,
} from "./membership-guest-pass"

export async function registerMembershipGuestPass(
    store: Pick<PrismaClient["membershipGuestPass"], "create" | "count">,
    input: { ticketId: string; staffId: string; eventId: string; today: string }
) {
    // `today` es el día civil de Lima obtenido una sola vez por la petición.
    const { today, ...ids } = input
    const month = today.slice(0, 7)
    const date = new Date(`${today}T12:00:00Z`)
    let registeredNumber: number | null = null

    // El índice único (ticketId, month, number) protege los tres cupos del mes
    // incluso cuando varios operadores registran pases simultáneamente.
    for (let number = 1; number <= GOLD_MEMBERSHIP_GUEST_PASS_LIMIT; number += 1) {
        try {
            await store.create({ data: { ...ids, month, number, date } })
            registeredNumber = number
            break
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                continue
            }
            throw error
        }
    }

    const used = await store.count({ where: { ticketId: ids.ticketId, month } })
    return { registeredNumber, guestPasses: buildMembershipGuestPassSummary(used) }
}
