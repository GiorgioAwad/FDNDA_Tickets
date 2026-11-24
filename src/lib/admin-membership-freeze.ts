import { getMembershipBlackoutMonths, isSummerMembership } from "./membership-config"
import {
    getMembershipAnchor, getMembershipExpiry, getMembershipFreezeMonthRange,
    getMembershipFreezeRanges, isFixedTermMembership, type ScanTicket,
} from "./scan-helpers"
import { formatDateUTC } from "./qr"

/** Administrative exceptions retain the original start date and existing freezes. */
export function planAdminMembershipFreeze(ticket: ScanTicket, input: unknown) {
    if (!isFixedTermMembership(ticket) || isSummerMembership(ticket.ticketType.membershipScheduleKey)) {
        throw new Error("Esta entrada no es una membresía congelable.")
    }
    if (ticket.status !== "ACTIVE") throw new Error("La membresía debe estar activa.")
    if (!Array.isArray(input) || input.length === 0 || input.length > 24) {
        throw new Error("Selecciona entre 1 y 24 meses para congelar.")
    }
    const months: string[] = []
    for (const month of input) {
        if (typeof month !== "string" || !getMembershipFreezeMonthRange(month)) {
            throw new Error("Cada mes debe tener el formato AAAA-MM.")
        }
        if (!months.includes(month)) months.push(month)
    }
    months.sort()
    const blackout = getMembershipBlackoutMonths(ticket.ticketType.membershipScheduleKey)
    const ranges = getMembershipFreezeRanges(ticket)
    const anchor = getMembershipAnchor(ticket)!
    const added: string[] = []
    for (const month of months) {
        const range = getMembershipFreezeMonthRange(month)!
        if (blackout.includes(Number(month.slice(5, 7)))) {
            throw new Error("Enero y febrero ya se extienden automáticamente; no deben congelarse otra vez.")
        }
        if (ranges.some((existing) => range.startStr < existing.endStr && range.endStr > existing.startStr)) continue
        const expiry = getMembershipExpiry(anchor, ticket.ticketType.membershipDurationMonths!, blackout, ranges)
        if (range.endStr <= formatDateUTC(anchor) || range.startStr >= expiry) {
            throw new Error(`El mes ${month} no coincide con la vigencia de la membresía (${formatDateUTC(anchor)} a ${expiry}).`)
        }
        ranges.push(range)
        added.push(month)
    }
    return { added, membershipExpiry: getMembershipExpiry(anchor, ticket.ticketType.membershipDurationMonths!, blackout, ranges) }
}
