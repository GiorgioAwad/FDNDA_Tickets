import {
    buildTicketDateReservationCounts,
    getTicketSelectableDates,
} from "@/lib/ticket-date-capacity"

export const isPoolFreeEventCategory = (value: unknown): boolean => value === "PISCINA_LIBRE"

export function getPoolFreeSelectableDates(input: {
    validDays: unknown
    eventStartDate: Date
    eventEndDate: Date
}): string[] {
    return getTicketSelectableDates(input)
}

export function buildPoolFreeReservationCounts(input: {
    attendees: unknown[]
    quantity: number
    validDays: unknown
    eventStartDate: Date
    eventEndDate: Date
    ticketLabel: string
    strict?: boolean
}): Map<string, number> {
    return buildTicketDateReservationCounts({
        ...input,
        requiredSelections: 1,
    })
}
