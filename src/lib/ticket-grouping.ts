import {
    normalizeScheduleSelections,
    type ScheduleSelection,
} from "@/lib/ticket-schedule"

type RawAttendee = {
    name?: unknown
    dni?: unknown
    scheduleSelections?: unknown
}

const normalizeName = (value: unknown): string =>
    typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : ""

const normalizeDocument = (value: unknown): string =>
    typeof value === "string" ? value.trim().toUpperCase().replace(/\s+/g, "") : ""

/**
 * Finds the schedule that produced a ticket. EVENTO tickets intentionally do
 * not persist attendee identity, so their position inside the OrderItem is the
 * reliable fallback when several tickets of the same type use different days.
 */
export function findTicketScheduleSelections(input: {
    attendees: unknown
    attendeeName: string | null
    attendeeDni: string | null
    attendeeIndex: number
}): ScheduleSelection[] {
    if (!Array.isArray(input.attendees)) return []

    const candidates = input.attendees.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return []
        const attendee = raw as RawAttendee
        return [{
            name: normalizeName(attendee.name),
            dni: normalizeDocument(attendee.dni),
            selections: normalizeScheduleSelections(attendee.scheduleSelections),
        }]
    })
    if (candidates.length === 0) return []

    const targetName = normalizeName(input.attendeeName)
    const targetDni = normalizeDocument(input.attendeeDni)
    const hasIdentity = Boolean(targetName || targetDni)

    if (hasIdentity) {
        let best: { score: number; selections: ScheduleSelection[] } | null = null
        for (const candidate of candidates) {
            let score = candidate.selections.length > 0 ? 1 : 0
            if (targetDni && candidate.dni && targetDni === candidate.dni) score += 4
            if (targetName && candidate.name && targetName === candidate.name) score += 2
            if (!best || score > best.score) best = { score, selections: candidate.selections }
        }

        // A positive identity match wins. Otherwise use the issuance position;
        // this avoids assigning every anonymous ticket the first buyer selection.
        if (best && best.score > 1) return best.selections
    }

    return candidates[input.attendeeIndex]?.selections
        ?? candidates.find((candidate) => candidate.selections.length > 0)?.selections
        ?? []
}

/** The group identity deliberately ignores shifts and ticket categories. */
export function buildTicketDateGroupKey(selections: ScheduleSelection[]): string | null {
    const dates = Array.from(new Set(selections.map((selection) => selection.date).filter(Boolean))).sort()
    return dates.length > 0 ? dates.join(";") : null
}

/**
 * Entitlements are the ticket-level source of truth for purchased dates. Keep
 * the shift recovered from attendeeData when it belongs to the same date.
 */
export function alignSelectionsToTicketDates(
    selections: ScheduleSelection[],
    ticketDates: string[]
): ScheduleSelection[] {
    if (ticketDates.length === 0) return selections

    const shiftByDate = new Map(
        selections.map((selection) => [selection.date, selection.shift ?? ""])
    )
    return Array.from(new Set(ticketDates)).sort().map((date) => ({
        date,
        shift: shiftByDate.get(date) ?? "",
    }))
}

export function mergeGroupScheduleSelections(
    selections: ScheduleSelection[][]
): ScheduleSelection[] {
    const unique = new Map<string, ScheduleSelection>()
    for (const selection of selections.flat()) {
        const shift = (selection.shift ?? "").trim()
        unique.set(`${selection.date}|${shift}`, { date: selection.date, shift })
    }
    return Array.from(unique.values()).sort(
        (left, right) => left.date.localeCompare(right.date)
            || (left.shift ?? "").localeCompare(right.shift ?? "")
    )
}
