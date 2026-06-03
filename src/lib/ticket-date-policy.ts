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
    const candidateDates = purchasedDates.length > 0 ? purchasedDates : entitlementDates

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
