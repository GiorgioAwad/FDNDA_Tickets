import { extractTicketValidDates, normalizeScheduleSelections } from "@/lib/ticket-schedule"
import { getDaysBetween } from "@/lib/utils"

type AttendeeWithSchedule = {
    scheduleSelections?: unknown
}

const toDateKey = (date: Date): string => {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

export const isPoolFreeEventCategory = (value: unknown): boolean => value === "PISCINA_LIBRE"

export function getPoolFreeSelectableDates(input: {
    validDays: unknown
    eventStartDate: Date
    eventEndDate: Date
}): string[] {
    const configuredDates = extractTicketValidDates(input.validDays)
    if (configuredDates.length > 0) {
        return configuredDates
    }

    return getDaysBetween(input.eventStartDate, input.eventEndDate).map(toDateKey)
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
    const strict = input.strict !== false
    const allowedDates = new Set(
        getPoolFreeSelectableDates({
            validDays: input.validDays,
            eventStartDate: input.eventStartDate,
            eventEndDate: input.eventEndDate,
        })
    )
    const counts = new Map<string, number>()

    for (let index = 0; index < input.quantity; index++) {
        const attendee = input.attendees[index] as AttendeeWithSchedule | undefined
        const selections = normalizeScheduleSelections(attendee?.scheduleSelections)
        const selectedDate = selections[0]?.date

        if (!selectedDate) {
            if (strict) {
                throw new Error(
                    `Debes seleccionar un dia para cada asistente de "${input.ticketLabel}"`
                )
            }
            continue
        }

        if (allowedDates.size > 0 && !allowedDates.has(selectedDate)) {
            if (strict) {
                throw new Error(
                    `El dia ${selectedDate} no es valido para "${input.ticketLabel}"`
                )
            }
            continue
        }

        counts.set(selectedDate, (counts.get(selectedDate) || 0) + 1)
    }

    return counts
}
