const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

export interface TicketScheduleConfig {
    dates: string[]
    shifts: string[]
    requireShiftSelection: boolean
    slots?: TicketScheduleSlot[]
}

export interface TicketScheduleSlot {
    date: string
    shifts: string[]
}

export interface ScheduleSelection {
    date: string
    shift: string | null
}

export function getLimaDateKey(date: Date = new Date()): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
}

export function getCurrentOrFutureScheduleDates(
    dates: string[],
    today: string = getLimaDateKey()
): string[] {
    return normalizeDateArray(dates).filter((date) => date >= today)
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

function normalizeScheduleSlots(values: unknown): TicketScheduleSlot[] {
    if (!Array.isArray(values)) return []

    const byDate = new Map<string, string[]>()
    for (const value of values) {
        if (!value || typeof value !== "object") continue
        const record = value as Record<string, unknown>
        const date = normalizeDate(record.date ?? record.day)
        if (!date) continue

        const shifts = normalizeShiftArray(record.shifts ?? record.turns)
        if (shifts.length === 0) continue

        const current = byDate.get(date) ?? []
        byDate.set(date, Array.from(new Set([...current, ...shifts])))
    }

    return Array.from(byDate.entries())
        .map(([date, shifts]) => ({ date, shifts }))
        .sort((a, b) => a.date.localeCompare(b.date))
}

function normalizeDateShiftMap(value: unknown): TicketScheduleSlot[] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return []

    const slots: TicketScheduleSlot[] = []
    for (const [dateKey, shiftsValue] of Object.entries(value as Record<string, unknown>)) {
        const date = normalizeDate(dateKey)
        if (!date) continue

        const shifts = normalizeShiftArray(shiftsValue)
        if (shifts.length === 0) continue
        slots.push({ date, shifts })
    }

    return slots.sort((a, b) => a.date.localeCompare(b.date))
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
        const slots = normalizeScheduleSlots(record.slots)
        const dateShiftSlots = normalizeDateShiftMap(record.dateShifts ?? record.dayShifts)
        const explicitSlots = slots.length > 0 ? slots : dateShiftSlots
        const configuredDates = byDates.length > 0 ? byDates : byValidDays.length > 0 ? byValidDays : byDays
        const dates = Array.from(
            new Set([...configuredDates, ...explicitSlots.map((slot) => slot.date)])
        ).sort((a, b) => a.localeCompare(b))
        const configuredShifts = byShifts.length > 0 ? byShifts : byTurns
        const shifts = Array.from(
            new Set([...configuredShifts, ...explicitSlots.flatMap((slot) => slot.shifts)])
        )
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
            slots: explicitSlots,
        }
    }

    return { dates: [], shifts: [], requireShiftSelection: false }
}

export function buildTicketValidDaysPayload(config: TicketScheduleConfig): unknown {
    const dates = normalizeDateArray(config.dates)
    const shifts = normalizeShiftArray(config.shifts)
    const slots = normalizeScheduleSlots(config.slots).filter((slot) => dates.includes(slot.date))

    if (dates.length === 0) return []
    if (shifts.length === 0) return dates

    const payload: {
        dates: string[]
        shifts: string[]
        slots?: TicketScheduleSlot[]
        requireShiftSelection?: boolean
    } = {
        dates,
        shifts,
    }

    if (slots.length > 0) {
        payload.slots = slots
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

export function getShiftOptionsForDate(
    config: TicketScheduleConfig,
    dateValue: unknown
): string[] {
    const date = normalizeDate(dateValue)
    if (!date) return config.shifts

    const slot = config.slots?.find((item) => item.date === date)
    return slot?.shifts.length ? slot.shifts : config.shifts
}
