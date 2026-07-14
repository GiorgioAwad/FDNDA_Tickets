import {
    extractTicketValidDates,
    normalizeScheduleSelections,
    parseTicketScheduleConfig,
} from "@/lib/ticket-schedule"
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

export const usesTicketDateCapacity = (input: {
    eventCategory: unknown
    capacityByDate?: boolean | null
}): boolean =>
    input.eventCategory === "PISCINA_LIBRE" ||
    (input.eventCategory === "EVENTO" && input.capacityByDate === true)

export function getTicketSelectableDates(input: {
    validDays: unknown
    eventStartDate: Date
    eventEndDate: Date
}): string[] {
    const configuredDates = extractTicketValidDates(input.validDays)
    if (configuredDates.length > 0) return configuredDates
    return getDaysBetween(input.eventStartDate, input.eventEndDate).map(toDateKey)
}

export function getRequiredTicketDateSelections(input: {
    validDays: unknown
    isPackage?: boolean | null
    packageDaysCount?: number | null
}): number {
    const schedule = parseTicketScheduleConfig(input.validDays)
    if (schedule.dates.length === 0) return 1
    if (input.isPackage && input.packageDaysCount && input.packageDaysCount > 0) {
        return input.packageDaysCount
    }
    return 1
}

/**
 * Agrupa el consumo diario de una compra. El turno se ignora deliberadamente:
 * todos los turnos de un mismo tipo comparten la bolsa del día.
 *
 * En una entrada simple cada asistente consume una fecha. En un full day/paquete
 * consume cada una de sus fechas elegidas.
 */
export function buildTicketDateReservationCounts(input: {
    attendees: unknown[]
    quantity: number
    validDays: unknown
    eventStartDate: Date
    eventEndDate: Date
    ticketLabel: string
    requiredSelections?: number
    strict?: boolean
}): Map<string, number> {
    const strict = input.strict !== false
    const requiredSelections = Math.max(1, Math.floor(input.requiredSelections ?? 1))
    const allowedDates = new Set(
        getTicketSelectableDates({
            validDays: input.validDays,
            eventStartDate: input.eventStartDate,
            eventEndDate: input.eventEndDate,
        })
    )
    const counts = new Map<string, number>()

    for (let index = 0; index < input.quantity; index++) {
        const attendee = input.attendees[index] as AttendeeWithSchedule | undefined
        const selections = normalizeScheduleSelections(attendee?.scheduleSelections)

        if (selections.length < requiredSelections) {
            if (strict) {
                throw new Error(
                    `Debes seleccionar ${requiredSelections === 1 ? "un dia" : `${requiredSelections} dias`} para cada entrada de "${input.ticketLabel}"`
                )
            }
            continue
        }

        for (const selection of selections.slice(0, requiredSelections)) {
            if (allowedDates.size > 0 && !allowedDates.has(selection.date)) {
                if (strict) {
                    throw new Error(
                        `El día ${selection.date} no es válido para "${input.ticketLabel}"`
                    )
                }
                continue
            }
            counts.set(selection.date, (counts.get(selection.date) ?? 0) + 1)
        }
    }

    return counts
}
