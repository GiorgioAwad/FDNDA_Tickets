import { formatDateUTC } from "@/lib/qr"
import {
    normalizeScheduleDate,
    type ScheduleSelection,
} from "@/lib/ticket-schedule"

type EntitlementForDatePolicy = {
    date: Date | string
    status?: string | null
}

function toDateKey(value: Date | string): string | null {
    if (typeof value === "string") {
        const dateOnly = normalizeScheduleDate(value)
        if (dateOnly) return dateOnly
    }

    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return formatDateUTC(date)
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
    return Array.from(
        new Set(values.filter((value): value is string => Boolean(value)))
    ).sort((a, b) => a.localeCompare(b))
}

export function getPurchasedDateKeys(
    scheduleSelections?: ScheduleSelection[] | null
): string[] {
    return uniqueSorted((scheduleSelections ?? []).map((selection) => selection.date))
}

export function ticketUsesPurchasedDates(input: {
    eventCategory?: string | null
    scheduleSelections?: ScheduleSelection[] | null
}): boolean {
    return input.eventCategory === "PISCINA_LIBRE" || getPurchasedDateKeys(input.scheduleSelections).length > 0
}

export function pickQrDateForTicket(input: {
    dateParam?: string | null
    today: string
    scheduleSelections?: ScheduleSelection[] | null
    entitlements?: EntitlementForDatePolicy[] | null
    usePurchasedDates: boolean
}): string | null {
    const requestedDate = normalizeScheduleDate(input.dateParam)
    if (requestedDate) return requestedDate

    if (!input.usePurchasedDates) return null

    const purchasedDates = getPurchasedDateKeys(input.scheduleSelections)
    const entitlementDates = uniqueSorted(
        (input.entitlements ?? []).map((entitlement) => toDateKey(entitlement.date))
    )
    // Los entitlements propios del ticket son la fuente de verdad de SU fecha.
    // Las purchasedDates se re-derivan de OrderItem.attendeeData por match de
    // nombre/DNI, que en piscina libre (asistente sin identidad) es ambiguo cuando
    // el mismo horario/ticketType se compró para varias fechas: devolvía la fecha
    // del primer orderItem para todos los tickets. Priorizar el entitlement evita
    // generar el QR con la fecha equivocada. Solo se cae a purchasedDates cuando el
    // ticket aún no tiene entitlements pre-generados.
    const candidateDates = entitlementDates.length > 0 ? entitlementDates : purchasedDates

    if (candidateDates.length === 0) return null

    const usedDates = new Set(
        (input.entitlements ?? [])
            .filter((entitlement) => entitlement.status === "USED")
            .map((entitlement) => toDateKey(entitlement.date))
            .filter((value): value is string => Boolean(value))
    )
    const availableDates = candidateDates.filter((date) => !usedDates.has(date))

    return (
        availableDates.find((date) => date >= input.today) ??
        candidateDates.find((date) => date >= input.today) ??
        availableDates[0] ??
        candidateDates[0] ??
        null
    )
}

export function canReassignToScanDate(input: {
    strictDateSchedule: boolean
    isPackageLike: boolean
    usesPurchasedDates: boolean
}): boolean {
    if (input.usesPurchasedDates) return false
    return !input.strictDateSchedule || input.isPackageLike
}
