import { formatDateUTC, formatDateLocal, getTodayDateString } from "@/lib/qr"
import { getDaysBetween } from "@/lib/utils"
import { extractTicketValidDates, parseTicketScheduleConfig } from "@/lib/ticket-schedule"

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
    orderId: string
    ticketTypeId: string
    ticketCode: string
    attendeeName: string | null
    attendeeDni: string | null
    status: "ACTIVE" | "CANCELLED" | "EXPIRED"
    eventId: string
    event: { title: string; startDate: Date; endDate: Date; category?: string }
    ticketType: {
        name: string
        isPackage: boolean
        packageDaysCount: number | null
        monthlyClassLimit?: number | null
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
    const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))

    while (current <= endDate) {
        if (days.includes(current.getUTCDay())) {
            results.push(new Date(current))
        }
        current.setUTCDate(current.getUTCDate() + 1)
    }
    return results
}

// ==================== MEMBRESÍAS (cupo mensual) ====================

export interface MembershipPeriod {
    index: number // mes 0-based desde el inicio del evento
    startStr: string // YYYY-MM-DD inclusivo
    endStr: string // YYYY-MM-DD exclusivo
}

const pad2 = (value: number): string => String(value).padStart(2, "0")

/**
 * Suma `k` meses a un día (Y-M-D), manteniendo el día ancla (clamp al último
 * día del mes destino). Devuelve "YYYY-MM-DD".
 */
const addMonthsToParts = (year: number, month: number, day: number, k: number): string => {
    const total = year * 12 + (month - 1) + k
    const ny = Math.floor(total / 12)
    const nm = (total % 12) + 1
    const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
    const nd = Math.min(day, lastDay)
    return `${ny}-${pad2(nm)}-${pad2(nd)}`
}

/**
 * Membresías: ¿el ticket usa cupo mensual con reinicio?
 */
export const isMembershipTicket = (ticket: ScanTicket): boolean => {
    const limit = ticket.ticketType.monthlyClassLimit
    return typeof limit === "number" && limit > 0
}

/**
 * Período (mes) de la membresía que contiene `today`, anclado al inicio del
 * evento (cohorte de fechas fijas). Los cortes caen en el día del mes del
 * `startDate`. Devuelve null si `today` es anterior al inicio.
 */
export const getMembershipPeriod = (today: string, eventStart: Date): MembershipPeriod | null => {
    const startStr = formatDateUTC(eventStart)
    const [sy, sm, sd] = startStr.split("-").map(Number)
    const [ty, tm, td] = today.split("-").map(Number)
    if (!sy || !sm || !sd || !ty || !tm || !td) return null
    if (today < startStr) return null

    let months = (ty - sy) * 12 + (tm - sm)
    if (td < sd) months -= 1
    if (months < 0) months = 0

    return {
        index: months,
        startStr: addMonthsToParts(sy, sm, sd, months),
        endStr: addMonthsToParts(sy, sm, sd, months + 1),
    }
}

/**
 * Resumen de asistencia para membresías: cupo total = límite mensual, usadas =
 * clases consumidas dentro del mes en curso. Lo no usado en meses previos no
 * cuenta (reinicio sin acumular).
 */
export const buildMembershipMonthlySummary = (
    ticket: ScanTicket,
    today: string
): AttendanceSummary => {
    const limit = ticket.ticketType.monthlyClassLimit ?? 0
    const period = getMembershipPeriod(today, ticket.event.startDate)
    if (!period) {
        return { total: limit, used: 0, remaining: limit }
    }
    const used = ticket.entitlements.filter((item) => {
        if (item.status !== "USED") return false
        const dateStr = formatDateUTC(item.date)
        return dateStr >= period.startStr && dateStr < period.endStr
    }).length
    return { total: limit, used, remaining: Math.max(limit - used, 0) }
}

/**
 * Build attendance summary from ticket data
 */
export const buildAttendanceSummary = (
    ticket: ScanTicket,
    today: string = getTodayDateString()
): AttendanceSummary => {
    if (isMembershipTicket(ticket)) {
        return buildMembershipMonthlySummary(ticket, today)
    }
    const used = ticket.entitlements.filter((item) => item.status === "USED").length
    let total = ticket.entitlements.length
    const scheduleConfig = parseTicketScheduleConfig(ticket.ticketType.validDays)
    const explicitValidDates = scheduleConfig.dates
    const configuredShifts = scheduleConfig.shifts
    const shiftMultiplier =
        !scheduleConfig.requireShiftSelection && configuredShifts.length > 1
            ? configuredShifts.length
            : 1

    // Try to extract total from ticket type name (e.g., "8 clases")
    const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
    const nameTotal = nameMatch ? Number(nameMatch[1]) : null

    if (ticket.ticketType.isPackage && ticket.ticketType.packageDaysCount) {
        total = ticket.ticketType.packageDaysCount * shiftMultiplier
    } else if (ticket.ticketType.isPackage) {
        total = (nameTotal ?? total) * shiftMultiplier
    } else if (explicitValidDates.length > 0) {
        const dateTotal = ticket.entitlements.length > 0 ? ticket.entitlements.length : explicitValidDates.length
        total = dateTotal * shiftMultiplier
    } else if (ticket.event?.startDate && ticket.event?.endDate) {
        const label = extractDaysLabel(ticket.ticketType.name)
        const validDays = label
            ? buildValidDaysFromLabel(ticket.event.startDate, ticket.event.endDate, label)
            : getDaysBetween(ticket.event.startDate, ticket.event.endDate)
        total = validDays.length * shiftMultiplier
    }

    // Override with name total if available (but still apply shift multiplier)
    if (nameTotal && nameTotal > 0) {
        total = nameTotal * shiftMultiplier
    }

    const remaining = Math.max(total - used, 0)
    return { total, used, remaining }
}

/**
 * Determine if ticket should behave like a package (sequential classes)
 */
export const isPackageLike = (ticket: ScanTicket): boolean => {
    const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
    return Boolean(ticket.ticketType.isPackage || ticket.ticketType.packageDaysCount || nameMatch)
}

/**
 * Generate entitlements for a ticket if missing
 */
export const generateEntitlements = (ticket: ScanTicket): Date[] => {
    // Membresías: el entitlement del día se crea al vuelo en el escaneo; nunca
    // se pre-genera el rango completo del evento.
    if (isMembershipTicket(ticket)) {
        return []
    }
    if (isPackageLike(ticket) || ticket.entitlements.length > 0) {
        return []
    }

    if (!ticket.event?.startDate || !ticket.event?.endDate) {
        return []
    }

    const explicitValidDates = extractTicketValidDates(ticket.ticketType.validDays)
    if (explicitValidDates.length > 0) {
        return explicitValidDates.map((date) => new Date(date))
    }

    const label = extractDaysLabel(ticket.ticketType.name)
    return label
        ? buildValidDaysFromLabel(ticket.event.startDate, ticket.event.endDate, label)
        : getDaysBetween(ticket.event.startDate, ticket.event.endDate)
}

/**
 * Check if package limit has been reached
 */
export const isPackageLimitReached = (
    ticket: ScanTicket,
    today: string = getTodayDateString()
): boolean => {
    if (isMembershipTicket(ticket)) {
        return buildMembershipMonthlySummary(ticket, today).remaining <= 0
    }
    const nameMatch = ticket.ticketType.name.match(/(\d+)\s*clases?/i)
    const packageLimit = ticket.ticketType.packageDaysCount ?? (nameMatch ? Number(nameMatch[1]) : null)
    if (!isPackageLike(ticket) || !packageLimit) {
        return false
    }
    const usedCount = ticket.entitlements.filter((e) => e.status === "USED").length
    return usedCount >= packageLimit
}

/**
 * Check if date is within event range
 */
export const isWithinEventRange = (ticket: ScanTicket, today: string): boolean => {
    const eventStart = ticket.event?.startDate ? formatDateUTC(ticket.event.startDate) : null
    const eventEnd = ticket.event?.endDate ? formatDateUTC(ticket.event.endDate) : null
    return eventStart && eventEnd ? today >= eventStart && today <= eventEnd : false
}
