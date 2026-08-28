import type { Prisma } from "@prisma/client"

import { extractTicketValidDates, normalizeScheduleSelections } from "@/lib/ticket-schedule"
import { getDaysBetween } from "@/lib/utils"

/** Lo minimo que `buildEntitlementDates` lee del asistente. */
export type EntitlementAttendee = {
    scheduleSelections?: unknown
}

export const toDateObjectsFromDateStrings = (values: string[]): Date[] => {
    const unique = Array.from(new Set(values))
    return unique.map((value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
        if (!match) return new Date(value)
        const [, year, month, day] = match
        return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0))
    })
}

export const buildEntitlementDates = (input: {
    ticketType: {
        isPackage: boolean
        packageDaysCount: number | null
        monthlyClassLimit?: number | null
        validDays: Prisma.JsonValue | null
    }
    event: {
        startDate: Date
        endDate: Date
    }
    attendee: EntitlementAttendee | null
    eventCategory?: string
}): Date[] => {
    // Membresías con cupo mensual: NO se pre-generan entitlements. Cada clase
    // crea el entitlement del día al vuelo durante el escaneo, y el control de
    // asistencia cuenta lo usado dentro del mes en curso (use-it-or-lose-it).
    if (input.ticketType.monthlyClassLimit) {
        return []
    }

    const configuredDates = extractTicketValidDates(input.ticketType.validDays)
    const allEventDates = getDaysBetween(input.event.startDate, input.event.endDate)
        .map((date) => date.toISOString().split("T")[0])
    const selectedDates = normalizeScheduleSelections(input.attendee?.scheduleSelections).map(
        (selection) => selection.date
    )

    // Piscina libre: solo 1 entitlement (el dia seleccionado)
    if (input.eventCategory === "PISCINA_LIBRE") {
        // Bolsa (paquete): NO se pre-generan entitlements. Cada visita se crea como
        // una PoolVisitReservation al reservar desde "Mi cuenta".
        if (input.ticketType.isPackage && input.ticketType.packageDaysCount) {
            return []
        }
        if (selectedDates.length > 0) {
            return toDateObjectsFromDateStrings([selectedDates[0]])
        }
        return [input.event.startDate]
    }

    if (input.ticketType.isPackage && input.ticketType.packageDaysCount) {
        const requiredDays = input.ticketType.packageDaysCount
        const chosenDates: string[] = []

        for (const date of selectedDates) {
            if (!chosenDates.includes(date)) {
                chosenDates.push(date)
            }
            if (chosenDates.length >= requiredDays) break
        }

        if (chosenDates.length < requiredDays) {
            for (const date of configuredDates) {
                if (!chosenDates.includes(date)) {
                    chosenDates.push(date)
                }
                if (chosenDates.length >= requiredDays) break
            }
        }

        if (chosenDates.length < requiredDays) {
            for (const date of allEventDates) {
                if (!chosenDates.includes(date)) {
                    chosenDates.push(date)
                }
                if (chosenDates.length >= requiredDays) break
            }
        }

        return toDateObjectsFromDateStrings(chosenDates.slice(0, requiredDays))
    }

    if (selectedDates.length > 0) {
        return toDateObjectsFromDateStrings(selectedDates)
    }

    if (configuredDates.length > 0) {
        return toDateObjectsFromDateStrings(configuredDates)
    }

    return getDaysBetween(input.event.startDate, input.event.endDate)
}
