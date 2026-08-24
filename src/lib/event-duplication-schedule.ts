import { parseTicketScheduleConfig } from "@/lib/ticket-schedule"

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
const WEEKDAY_LABELS = [
    "Domingo",
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
] as const

export type DuplicateScheduleFrequency = {
    key: string
    label: string
    weekdays: number[]
    ticketTypeCount: number
}

function toDateKeyUTC(date: Date): string {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

export function isValidDateKey(value: unknown): value is string {
    if (typeof value !== "string" || !DATE_KEY_RE.test(value)) return false
    const [year, month, day] = value.split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, 12))
    return !Number.isNaN(date.getTime()) && toDateKeyUTC(date) === value
}

export function weekdayOfDateKey(dateKey: string): number {
    const [year, month, day] = dateKey.split("-").map(Number)
    return new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()
}

export function normalizeWeekdays(weekdays: Iterable<number>): number[] {
    const unique = new Set(Array.from(weekdays).filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6))
    return WEEKDAY_ORDER.filter((weekday) => unique.has(weekday))
}

export function frequencyKeyFromWeekdays(weekdays: Iterable<number>): string {
    return normalizeWeekdays(weekdays).join(",")
}

export function frequencyKeyFromDates(dates: string[]): string {
    return frequencyKeyFromWeekdays(
        dates.filter(isValidDateKey).map(weekdayOfDateKey),
    )
}

export function parseFrequencyKey(key: string): number[] | null {
    if (!/^\d(?:,\d)*$/.test(key)) return null
    const weekdays = normalizeWeekdays(key.split(",").map(Number))
    return weekdays.length > 0 && frequencyKeyFromWeekdays(weekdays) === key ? weekdays : null
}

export function formatFrequencyLabel(weekdays: Iterable<number>): string {
    const labels = normalizeWeekdays(weekdays).map((weekday) => WEEKDAY_LABELS[weekday])
    if (labels.length <= 1) return labels[0] ?? "Sin días"
    if (labels.length === 2) return `${labels[0]} y ${labels[1]}`
    return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`
}

export function getDuplicateScheduleFrequencies(
    ticketTypes: Array<{ validDays: unknown }>,
): DuplicateScheduleFrequency[] {
    const byKey = new Map<string, DuplicateScheduleFrequency>()

    for (const ticketType of ticketTypes) {
        const dates = parseTicketScheduleConfig(ticketType.validDays).dates
        const key = frequencyKeyFromDates(dates)
        if (!key) continue

        const existing = byKey.get(key)
        if (existing) {
            existing.ticketTypeCount += 1
            continue
        }

        const weekdays = parseFrequencyKey(key) ?? []
        byKey.set(key, {
            key,
            label: formatFrequencyLabel(weekdays),
            weekdays,
            ticketTypeCount: 1,
        })
    }

    return Array.from(byKey.values()).sort((a, b) => {
        const firstDay = (frequency: DuplicateScheduleFrequency) =>
            WEEKDAY_ORDER.indexOf(frequency.weekdays[0] as (typeof WEEKDAY_ORDER)[number])
        return firstDay(a) - firstDay(b) || a.key.localeCompare(b.key)
    })
}

export function listDateKeysBetween(startKey: string, endKey: string): string[] {
    if (!isValidDateKey(startKey) || !isValidDateKey(endKey) || startKey > endKey) return []
    const [startYear, startMonth, startDay] = startKey.split("-").map(Number)
    const [endYear, endMonth, endDay] = endKey.split("-").map(Number)
    const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay, 12))
    const end = new Date(Date.UTC(endYear, endMonth - 1, endDay, 12))
    const dates: string[] = []

    while (cursor.getTime() <= end.getTime()) {
        dates.push(toDateKeyUTC(cursor))
        cursor.setUTCDate(cursor.getUTCDate() + 1)
    }

    return dates
}

export function getFirstFrequencyDate(
    weekdays: Iterable<number>,
    startKey: string,
    endKey: string,
): string | null {
    const allowed = new Set(normalizeWeekdays(weekdays))
    return listDateKeysBetween(startKey, endKey).find((date) => allowed.has(weekdayOfDateKey(date))) ?? null
}

export function remapDatesByFrequency(
    sourceDates: string[],
    targetDates: string[],
    frequencyStartDate?: string,
): string[] {
    const weekdays = new Set(
        sourceDates.filter(isValidDateKey).map(weekdayOfDateKey),
    )
    if (weekdays.size === 0) return []

    return Array.from(new Set(
        targetDates.filter((date) =>
            isValidDateKey(date) &&
            weekdays.has(weekdayOfDateKey(date)) &&
            (!frequencyStartDate || date >= frequencyStartDate)
        ),
    )).sort()
}
