import { normalizeScheduleSelections } from "@/lib/ticket-schedule"

export const LIMA_TIME_ZONE = "America/Lima"

const LIMA_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export type DiscountCartItem = {
    ticketTypeId: string
    quantity: number
    unitPrice: number
    attendees?: Array<{ scheduleSelections?: unknown }>
}

export function parseLimaDateTimeInput(value: string, options: { endOfMinute?: boolean } = {}): Date {
    const match = LIMA_DATE_TIME_PATTERN.exec(value)
    if (!match) {
        throw new Error("Fecha y hora inválidas")
    }

    const [, year, month, day, hour, minute] = match
    const second = options.endOfMinute ? "59.999" : "00"
    const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-05:00`)

    if (Number.isNaN(parsed.getTime()) || formatLimaDateTimeInput(parsed) !== value) {
        throw new Error("Fecha y hora inválidas")
    }

    return parsed
}

export function formatLimaDateTimeInput(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return ""

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: LIMA_TIME_ZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((entry) => entry.type === type)?.value ?? ""

    return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`
}

export function getDiscountEligibleSubtotal(input: {
    items: DiscountCartItem[]
    ticketTypeId?: string | null
    validDate?: string | null
}): number {
    const { items, ticketTypeId, validDate } = input

    return items.reduce((total, item) => {
        if (ticketTypeId && item.ticketTypeId !== ticketTypeId) return total
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) return total
        if (!Number.isFinite(item.unitPrice) || item.unitPrice < 0) return total

        if (!validDate) {
            return total + item.unitPrice * item.quantity
        }

        const eligibleUnits = (item.attendees ?? [])
            .slice(0, item.quantity)
            .filter((attendee) =>
                normalizeScheduleSelections(attendee.scheduleSelections)
                    .some((selection) => selection.date === validDate)
            ).length

        return total + item.unitPrice * eligibleUnits
    }, 0)
}

export function calculateDiscountAmount(input: {
    eligibleSubtotal: number
    type: "PERCENTAGE" | "FIXED"
    value: number
}): number {
    const { eligibleSubtotal, type, value } = input
    if (!Number.isFinite(eligibleSubtotal) || eligibleSubtotal <= 0) return 0
    if (!Number.isFinite(value) || value <= 0) return 0

    const amount = type === "PERCENTAGE"
        ? eligibleSubtotal * value / 100
        : Math.min(value, eligibleSubtotal)

    return Math.round(amount * 100) / 100
}
