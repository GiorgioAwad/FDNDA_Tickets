import { formatDateUTC, formatDateLocal } from "@/lib/qr"
import { getDaysBetween } from "@/lib/utils"

// ==================== TYPES ====================

export type ScanResultType = "VALID" | "INVALID" | "ALREADY_USED" | "WRONG_DAY" | "WRONG_EVENT" | "EXPIRED"

export type TicketEntitlement = {
    id: string
    date: Date
    status: "AVAILABLE" | "USED"
    usedAt: Date | null
}

export type ScanTicket = {
    id: string
    ticketCode: string
    attendeeName: string | null
    attendeeDni: string | null
    status: "ACTIVE" | "CANCELLED" | "EXPIRED"
    eventId: string
    event: { title: string; startDate: Date; endDate: Date }
    ticketType: { 
        name: string
        isPackage: boolean
        packageDaysCount: number | null
        validDays: unknown | null 
    }
    entitlements: TicketEntitlement[]
}

export interface AttendanceSummary {
    total: number
    used: number
    remaining: number
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if a date matches today (handles timezone differences)
 */
export const matchesToday = (date: Date, today: string): boolean => {
    return formatDateUTC(date) === today || formatDateLocal(date) === today
}

/**
 * Get weekday indexes from day label (e.g., "L-M-X" -> [1, 2, 3])
 */
export const getWeekdayIndexes = (label: string): number[] => {
    const map: Record<string, number> = {
        L: 1, // Monday
        M: 2, // Tuesday
        X: 3, // Wednesday
        J: 4, // Thursday
        V: 5, // Friday
        S: 6, // Saturday
        D: 0, // Sunday
    }
    return label
        .split("-")
        .map((part) => map[part.toUpperCase()])
        .filter((val) => val !== undefined)
}

/**
 * Extract days label from ticket type name (e.g., "Turno L-M-X" -> "L-M-X")
 */
export const extractDaysLabel = (name: string): string | null => {
    const match = name.match(/Turno\s+([LMDXVJS-]+)/i) || 
                  name.match(/\b([LMDXVJS](?:-[LMDXVJS]){1,6})\b/i)
    return match?.[1]?.toUpperCase() ?? null
}

/**
 * Build array of valid days from a label and date range
 */
export const buildValidDaysFromLabel = (
    start: Date, 
    end: Date, 
    label: string
): Date[] => {
    const days = getWeekdayIndexes(label)
    if (!days.length) return []
    
    const results: Date[] = []
    const current = new Date(start)
    current.setHours(0, 0, 0, 0)
    const endDate = new Date(end)
    endDate.setHours(0, 0, 0, 0)

    while (current <= endDate) {
        if (days.includes(current.getDay())) {
            results.push(new Date(current))
        }
        current.setDate(current.getDate() + 1)
    }
    return results
}

/**
 * Build attendance summary from ticket data
 */
export const buildAttendanceSummary = (ticket: ScanTicket): AttendanceSummary => {
    const used = ticket.entitlements.filter((item) => item.status === "USED").length
    let total = ticket.entitlements.length

    // Try to extract total from ticket type name (e.g., "8 clases")
    const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
    const nameTotal = nameMatch ? Number(nameMatch[1]) : null

    if (ticket.ticketType.isPackage && ticket.ticketType.packageDaysCount) {
        total = ticket.ticketType.packageDaysCount
    } else if (ticket.ticketType.isPackage) {
        total = nameTotal ?? total
    } else if (Array.isArray(ticket.ticketType.validDays)) {
        total = ticket.ticketType.validDays.length
    } else if (ticket.event?.startDate && ticket.event?.endDate) {
        const label = extractDaysLabel(ticket.ticketType.name)
        const validDays = label
            ? buildValidDaysFromLabel(ticket.event.startDate, ticket.event.endDate, label)
            : getDaysBetween(ticket.event.startDate, ticket.event.endDate)
        total = validDays.length
    }

    // Override with name total if available
    if (nameTotal && nameTotal > 0) {
        total = nameTotal
    }

    const remaining = Math.max(total - used, 0)
    return { total, used, remaining }
}

/**
 * Generate entitlements for a ticket if missing
 */
export const generateEntitlements = (ticket: ScanTicket): Date[] => {
    if (ticket.ticketType.isPackage || ticket.entitlements.length > 0) {
        return []
    }

    if (!ticket.event?.startDate || !ticket.event?.endDate) {
        return []
    }

    if (Array.isArray(ticket.ticketType.validDays)) {
        return (ticket.ticketType.validDays as string[]).map((date) => new Date(date))
    }

    const label = extractDaysLabel(ticket.ticketType.name)
    return label
        ? buildValidDaysFromLabel(ticket.event.startDate, ticket.event.endDate, label)
        : getDaysBetween(ticket.event.startDate, ticket.event.endDate)
}

/**
 * Check if package limit has been reached
 */
export const isPackageLimitReached = (ticket: ScanTicket): boolean => {
    if (!ticket.ticketType.isPackage || !ticket.ticketType.packageDaysCount) {
        return false
    }
    const usedCount = ticket.entitlements.filter((e) => e.status === "USED").length
    return usedCount >= ticket.ticketType.packageDaysCount
}

/**
 * Check if date is within event range
 */
export const isWithinEventRange = (ticket: ScanTicket, today: string): boolean => {
    const eventStart = ticket.event?.startDate ? formatDateUTC(ticket.event.startDate) : null
    const eventEnd = ticket.event?.endDate ? formatDateUTC(ticket.event.endDate) : null
    return eventStart && eventEnd ? today >= eventStart && today <= eventEnd : false
}
