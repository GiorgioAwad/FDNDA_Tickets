const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export interface TicketScheduleConfig {
    dates: string[]
    shifts: string[]
    requireShiftSelection: boolean
}

export interface ScheduleSelection {
    date: string
    shift: string | null
}

function normalizeDate(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!DATE_REGEX.test(trimmed)) return null
    return trimmed
}

function normalizeShift(value: unknown): string | null {
    if (typeof value === "string") {
        const trimmed = value.trim()
        return trimmed ? trimmed : null
    }

    if (value && typeof value === "object") {
        const record = value as Record<string, unknown>
        const name = typeof record.name === "string" ? record.name.trim() : ""
        const startTime = typeof record.startTime === "string" ? record.startTime.trim() : ""
        const endTime = typeof record.endTime === "string" ? record.endTime.trim() : ""

        if (!name) return null
        if (startTime && endTime) {
            return `${name} (${startTime}-${endTime})`
        }
        return name
    }

    return null
}

export function normalizeShiftLabel(value: unknown): string | null {
    return normalizeShift(value)
}

export function normalizeScheduleDate(value: unknown): string | null {
    return normalizeDate(value)
}

function normalizeDateArray(values: unknown): string[] {
    if (!Array.isArray(values)) return []
    const normalized = values
        .map((value) => normalizeDate(value))
        .filter((value): value is string => Boolean(value))
    return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b))
}

function normalizeShiftArray(values: unknown): string[] {
    if (!Array.isArray(values)) return []
    const normalized = values
        .map((value) => normalizeShift(value))
        .filter((value): value is string => Boolean(value))
    return Array.from(new Set(normalized))
}

export function parseTicketScheduleConfig(validDays: unknown): TicketScheduleConfig {
    if (Array.isArray(validDays)) {
        return {
            dates: normalizeDateArray(validDays),
            shifts: [],
            requireShiftSelection: false,
        }
    }

    if (validDays && typeof validDays === "object") {
        const record = validDays as Record<string, unknown>
        const byDates = normalizeDateArray(record.dates)
        const byValidDays = normalizeDateArray(record.validDays)
        const byDays = normalizeDateArray(record.days)
        const byShifts = normalizeShiftArray(record.shifts)
        const byTurns = normalizeShiftArray(record.turns)
        const dates = byDates.length > 0 ? byDates : byValidDays.length > 0 ? byValidDays : byDays
        const shifts = byShifts.length > 0 ? byShifts : byTurns
        const requireShiftSelectionRaw = record.requireShiftSelection
        const shiftOptionalRaw = record.shiftOptional
        const requireShiftSelection =
            shifts.length === 0
                ? false
                : typeof requireShiftSelectionRaw === "boolean"
                  ? requireShiftSelectionRaw
                  : typeof shiftOptionalRaw === "boolean"
                    ? !shiftOptionalRaw
                    : true

        return {
            dates,
            shifts,
            requireShiftSelection,
        }
    }

    return { dates: [], shifts: [], requireShiftSelection: false }
}

export function buildTicketValidDaysPayload(config: TicketScheduleConfig): unknown {
    const dates = normalizeDateArray(config.dates)
    const shifts = normalizeShiftArray(config.shifts)

    if (dates.length === 0) return []
    if (shifts.length === 0) return dates

    const payload: {
        dates: string[]
        shifts: string[]
        requireShiftSelection?: boolean
    } = {
        dates,
        shifts,
    }

    if (config.requireShiftSelection === false) {
        payload.requireShiftSelection = false
    }

    return payload
}

export function normalizeScheduleSelections(input: unknown): ScheduleSelection[] {
    if (!Array.isArray(input)) return []

    const selections: ScheduleSelection[] = []
    for (const item of input) {
        if (!item || typeof item !== "object") continue
        const record = item as Record<string, unknown>
        const date = normalizeDate(record.date)
        if (!date) continue
        const shift = normalizeShift(record.shift)
        selections.push({ date, shift: shift ?? null })
    }

    const unique = new Map<string, ScheduleSelection>()
    for (const selection of selections) {
        const key = `${selection.date}::${selection.shift ?? ""}`
        if (!unique.has(key)) {
            unique.set(key, selection)
        }
    }

    return Array.from(unique.values())
}

export function extractTicketValidDates(validDays: unknown): string[] {
    return parseTicketScheduleConfig(validDays).dates
}

export function extractTicketShiftOptions(validDays: unknown): string[] {
    return parseTicketScheduleConfig(validDays).shifts
}
