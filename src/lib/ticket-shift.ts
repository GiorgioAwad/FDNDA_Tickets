import { prisma } from "@/lib/prisma"
import {
    normalizeScheduleDate,
    normalizeScheduleSelections,
    normalizeShiftLabel,
    type ScheduleSelection,
} from "@/lib/ticket-schedule"

type StoredAttendeeData = {
    name?: unknown
    dni?: unknown
    scheduleSelections?: unknown
}

type AttendeeScheduleCandidate = {
    name: string
    dni: string
    selections: ScheduleSelection[]
}

const normalizeNameForMatch = (value: unknown): string => {
    if (typeof value !== "string") return ""
    return value.trim().toLowerCase().replace(/\s+/g, " ")
}

const normalizeDocumentForMatch = (value: unknown): string => {
    if (typeof value !== "string") return ""
    return value.trim().toUpperCase().replace(/\s+/g, "")
}

const toCandidate = (value: unknown): AttendeeScheduleCandidate | null => {
    if (!value || typeof value !== "object") return null
    const record = value as StoredAttendeeData
    return {
        name: normalizeNameForMatch(record.name),
        dni: normalizeDocumentForMatch(record.dni),
        selections: normalizeScheduleSelections(record.scheduleSelections),
    }
}

const getCandidateScore = (
    candidate: AttendeeScheduleCandidate,
    targetName: string,
    targetDni: string
): number => {
    const hasSelections = candidate.selections.length > 0
    let score = hasSelections ? 1 : 0

    const nameMatch = targetName.length > 0 && candidate.name === targetName
    const dniMatch = targetDni.length > 0 && candidate.dni === targetDni

    if (nameMatch) score += 2
    if (dniMatch) score += 4
    if (nameMatch && dniMatch) score += 10

    return score
}

export async function getTicketScheduleSelectionsForAttendee(input: {
    orderId: string
    ticketTypeId: string
    attendeeName?: string | null
    attendeeDni?: string | null
}): Promise<ScheduleSelection[]> {
    const orderItems = await prisma.orderItem.findMany({
        where: {
            orderId: input.orderId,
            ticketTypeId: input.ticketTypeId,
        },
        select: {
            attendeeData: true,
        },
    })

    const candidates: AttendeeScheduleCandidate[] = []
    for (const item of orderItems) {
        if (!Array.isArray(item.attendeeData)) continue

        for (const attendee of item.attendeeData) {
            const candidate = toCandidate(attendee)
            if (candidate) {
                candidates.push(candidate)
            }
        }
    }

    if (candidates.length === 0) return []

    const targetName = normalizeNameForMatch(input.attendeeName)
    const targetDni = normalizeDocumentForMatch(input.attendeeDni)

    let bestCandidate = candidates[0]
    let bestScore = getCandidateScore(bestCandidate, targetName, targetDni)

    for (let i = 1; i < candidates.length; i++) {
        const candidate = candidates[i]
        const score = getCandidateScore(candidate, targetName, targetDni)
        if (score > bestScore) {
            bestCandidate = candidate
            bestScore = score
        }
    }

    if (bestCandidate.selections.length > 0) {
        return bestCandidate.selections
    }

    const firstWithSelections = candidates.find((candidate) => candidate.selections.length > 0)
    return firstWithSelections?.selections ?? []
}

export function getExpectedShiftForDate(
    selections: ScheduleSelection[],
    date: string
): string | null {
    const normalizedDate = normalizeScheduleDate(date)
    if (!normalizedDate) return null

    const selected = selections.find((selection) => selection.date === normalizedDate)
    return normalizeShiftLabel(selected?.shift)
}

export function shiftsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
    const normalizedLeft = normalizeShiftLabel(left)?.toLowerCase() ?? null
    const normalizedRight = normalizeShiftLabel(right)?.toLowerCase() ?? null

    if (!normalizedLeft && !normalizedRight) return true
    if (normalizedLeft === normalizedRight) return true

    const compactLeft = normalizedLeft?.replace(/\s*\(.*\)\s*$/, "").trim() ?? null
    const compactRight = normalizedRight?.replace(/\s*\(.*\)\s*$/, "").trim() ?? null
    return compactLeft !== null && compactLeft === compactRight
}
