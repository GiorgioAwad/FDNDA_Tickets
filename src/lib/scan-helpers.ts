import { formatDateUTC, formatDateLocal, getTodayDateString } from "@/lib/qr"
import { getDaysBetween } from "@/lib/utils"
import { extractTicketValidDates, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import { MEMBERSHIP_BLACKOUT_MONTHS, isBlackoutMonth } from "@/lib/membership-config"
import {
    parseMembershipScheduleSelection,
    getEffectiveMembershipSchedule,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"

// ==================== TYPES ====================

export type ScanResultType = "VALID" | "INVALID" | "ALREADY_USED" | "WRONG_DAY" | "WRONG_EVENT" | "EXPIRED"

export type TicketEntitlement = {
    id: string
    date: Date
    status: "AVAILABLE" | "USED"
    usedAt: Date | null
}

export type MembershipFreezeRange = {
    month: string
    startDate: Date | string
    endDate: Date | string
    createdAt?: Date | string
}

export type MembershipFreezeMonthRange = {
    month: string
    startStr: string
    endStr: string
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
    // Fecha de inicio elegida por el comprador (membresías a término fijo).
    // null = legacy → se ancla a event.startDate.
    membershipStartDate?: Date | null
    // Horario semanal fijo elegido por el comprador (membresías de natación).
    // JSON normalizado (MembershipScheduleSelection). null = sin horario semanal.
    membershipSchedule?: unknown | null
    // Cambios de horario por mes (membresías semestral/anual). Cada fila rige
    // desde su monthIndex en adelante; el base/mes 0 es membershipSchedule.
    monthlySchedules?: { monthIndex: number; selection: unknown }[] | null
    // Congelamiento voluntario: un mes calendario completo por membresía.
    membershipFreeze?: MembershipFreezeRange | null
    event: { title: string; startDate: Date; endDate: Date; category?: string }
    ticketType: {
        name: string
        isPackage: boolean
        packageDaysCount: number | null
        monthlyClassLimit?: number | null
        // 6 = semestral, 12 = anual. null = vigencia ligada al evento (legacy).
        membershipDurationMonths?: number | null
        // Membresías ORO: permite varios ingresos por día (cada uno cuenta al cupo).
        allowMultipleDailyScans?: boolean | null
        // Clave del perfil de horario semanal (ver membership-schedule.ts).
        membershipScheduleKey?: string | null
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

const addMonthsToDateStr = (dateStr: string, months: number): string => {
    const [year, month, day] = dateStr.split("-").map(Number)
    if (!year || !month || !day) return dateStr
    return addMonthsToParts(year, month, day, months)
}

const formatDateLikeUTC = (value: Date | string): string => {
    if (value instanceof Date) return formatDateUTC(value)
    return value.length >= 10 ? value.slice(0, 10) : value
}

const getLimaDateParts = (date: Date): { year: number; month: number; day: number } => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date)
    const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? "0")
    return { year: get("year"), month: get("month"), day: get("day") }
}

const getLimaDateString = (date: Date): string => {
    const { year, month, day } = getLimaDateParts(date)
    return `${year}-${pad2(month)}-${pad2(day)}`
}

const addMonthsToMonthKey = (monthKey: string, months: number): string => {
    const [year, month] = monthKey.split("-").map(Number)
    if (!year || !month) return monthKey
    const total = year * 12 + (month - 1) + months
    const ny = Math.floor(total / 12)
    const nm = (total % 12) + 1
    return `${ny}-${pad2(nm)}`
}

const startOfMonthInLimaAsUtc = (monthKey: string): Date | null => {
    const [year, month] = monthKey.split("-").map(Number)
    if (!year || !month) return null
    return new Date(Date.UTC(year, month - 1, 1, 5, 0, 0))
}

const dmy = (isoDate: string): string => {
    const [y, m, d] = isoDate.split("-")
    return y && m && d ? `${d}/${m}/${y}` : isoDate
}

export const getMembershipFreezeMonthRange = (month: string): MembershipFreezeMonthRange | null => {
    if (!/^\d{4}-\d{2}$/.test(month)) return null
    const [year, monthOneBased] = month.split("-").map(Number)
    if (!year || !monthOneBased || monthOneBased < 1 || monthOneBased > 12) return null

    const startStr = `${year}-${pad2(monthOneBased)}-01`
    const endStr = addMonthsToDateStr(startStr, 1)
    return { month, startStr, endStr }
}

export const getMembershipFreezeRanges = (ticket: Pick<ScanTicket, "membershipFreeze">): MembershipFreezeMonthRange[] => {
    const freeze = ticket.membershipFreeze
    if (!freeze) return []

    const byMonth = getMembershipFreezeMonthRange(freeze.month)
    if (byMonth) return [byMonth]

    const startStr = formatDateLikeUTC(freeze.startDate)
    const endStr = formatDateLikeUTC(freeze.endDate)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startStr) || !/^\d{4}-\d{2}-\d{2}$/.test(endStr)) return []
    return [{ month: startStr.slice(0, 7), startStr, endStr }]
}

export const findMembershipFreezeForDate = (
    ticket: Pick<ScanTicket, "membershipFreeze">,
    today: string
): MembershipFreezeMonthRange | null =>
    getMembershipFreezeRanges(ticket).find((freeze) => today >= freeze.startStr && today < freeze.endStr) ?? null

/**
 * Membresías: ¿el ticket usa cupo mensual con reinicio?
 */
export const isMembershipTicket = (ticket: ScanTicket): boolean => {
    const limit = ticket.ticketType.monthlyClassLimit
    return typeof limit === "number" && limit > 0
}

/**
 * Membresía con varios ingresos por día (ej. ORO): no se bloquea el reingreso del
 * mismo día y cada escaneo cuenta como 1 clase del cupo mensual (se cuenta por
 * scans VALID del mes). Solo aplica a membresías (monthlyClassLimit).
 */
export const membershipAllowsMultipleDailyScans = (ticket: ScanTicket): boolean =>
    isMembershipTicket(ticket) && ticket.ticketType.allowMultipleDailyScans === true

/**
 * Membresía a término fijo (anual/semestral): el comprador eligió fecha de
 * inicio y el ticket type define una duración en meses. Solo en este caso aplican
 * la ventana de vigencia desacoplada del evento + el blackout enero/febrero.
 * Las membresías legacy (sin estos campos) caen al comportamiento anclado al
 * evento, sin blackout.
 */
export const isFixedTermMembership = (ticket: ScanTicket): boolean => {
    const duration = ticket.ticketType.membershipDurationMonths
    return (
        isMembershipTicket(ticket) &&
        ticket.membershipStartDate != null &&
        typeof duration === "number" &&
        duration > 0
    )
}

/**
 * Membresía de natación con horario semanal fijo: el comprador eligió categoría +
 * frecuencia + hora en el checkout y quedó guardado en `Ticket.membershipSchedule`.
 * Sólo en este caso el escáner valida día+hora. Es independiente del cupo mensual
 * (una entrada puede tener horario sin tener cupo). Devuelve la selección o null.
 */
export const getMembershipScheduleSelection = (
    ticket: ScanTicket
): MembershipScheduleSelection | null => parseMembershipScheduleSelection(ticket.membershipSchedule)

/** ¿El ticket es una membresía con horario semanal fijo guardado? */
export const hasWeeklySchedule = (ticket: ScanTicket): boolean =>
    getMembershipScheduleSelection(ticket) != null

/**
 * Horario semanal EFECTIVO para el mes `monthIndex` de la membresía (0-based
 * desde el ancla): aplica el cambio mensual vigente (override) o, si no hay,
 * hereda el mes anterior hasta llegar al horario de checkout. El escáner usa
 * esto en vez de `getMembershipScheduleSelection` (estático).
 */
export const getEffectiveScheduleSelection = (
    ticket: ScanTicket,
    monthIndex: number
): MembershipScheduleSelection | null => {
    const base = parseMembershipScheduleSelection(ticket.membershipSchedule)
    const overrides = (ticket.monthlySchedules ?? []).map((m) => ({
        monthIndex: m.monthIndex,
        selection: parseMembershipScheduleSelection(m.selection),
    }))
    return getEffectiveMembershipSchedule(base, overrides, monthIndex)
}

/**
 * Ancla de la membresía: la fecha de inicio elegida por el comprador o, en
 * tickets legacy, el inicio del evento. Todos los cortes mensuales y la vigencia
 * se calculan a partir de aquí.
 */
export const getMembershipAnchor = (ticket: ScanTicket): Date | null =>
    ticket.membershipStartDate ?? ticket.event?.startDate ?? null

/**
 * Período (mes) de la membresía que contiene `today`, anclado a `anchor`.
 * Los cortes caen en el día del mes del ancla. Devuelve null si `today` es
 * anterior al inicio. El blackout no afecta este conteo: en ene/feb el QR ya
 * está bloqueado aguas arriba, así que el cupo simplemente no se consume.
 */
export const getMembershipPeriod = (today: string, anchor: Date): MembershipPeriod | null => {
    const startStr = formatDateUTC(anchor)
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
 * Fecha de expiración (exclusiva, "YYYY-MM-DD") de una membresía a término fijo.
 * Cuenta `durationMonths` meses ACTIVOS desde el ancla: cada ciclo mensual cuyo
 * mes-inicio no es blackout cuenta como un mes activo; los meses blackout se
 * iteran pero NO cuentan (freeze + extend). Así un anual (12) que cruza ene/feb
 * se extiende ~14 meses calendario.
 */
export const getMembershipExpiry = (
    anchor: Date,
    durationMonths: number,
    blackout: readonly number[] = MEMBERSHIP_BLACKOUT_MONTHS,
    freezes: readonly MembershipFreezeMonthRange[] = []
): string => {
    const startStr = formatDateUTC(anchor)
    const [sy, sm, sd] = startStr.split("-").map(Number)
    if (!sy || !sm || !sd || durationMonths <= 0) return startStr

    let active = 0
    let k = 0
    // Guardia: tope de iteraciones (duración + todos los blackouts posibles).
    const maxIterations = (durationMonths + blackout.length) * 12 + 12
    while (active < durationMonths && k < maxIterations) {
        const monthOneBased = ((sm - 1 + k) % 12 + 12) % 12 + 1
        if (!isBlackoutMonth(monthOneBased, blackout)) {
            active += 1
        }
        k += 1
    }
    const baseExpiry = addMonthsToParts(sy, sm, sd, k)
    return addMonthsToDateStr(baseExpiry, freezes.length)
}

export type MembershipAccessStatus = "OK" | "NOT_STARTED" | "EXPIRED" | "BLACKOUT" | "FROZEN" | "NOT_APPLICABLE"

/**
 * Estado de acceso de una membresía a término fijo para el día `today`
 * (string "YYYY-MM-DD" en hora Lima, vía getTodayDateString). Devuelve también
 * las fechas calculadas para construir mensajes. Para membresías que no son a
 * término fijo devuelve NOT_APPLICABLE (el llamador usa la lógica legacy).
 */
export const getMembershipAccessStatus = (
    ticket: ScanTicket,
    today: string,
    blackout: readonly number[] = MEMBERSHIP_BLACKOUT_MONTHS
): {
    status: MembershipAccessStatus
    startStr: string
    expiryStr: string
    freeze?: MembershipFreezeMonthRange
} => {
    if (!isFixedTermMembership(ticket)) {
        return { status: "NOT_APPLICABLE", startStr: "", expiryStr: "" }
    }
    const anchor = getMembershipAnchor(ticket)!
    const duration = ticket.ticketType.membershipDurationMonths!
    const freezes = getMembershipFreezeRanges(ticket)
    const startStr = formatDateUTC(anchor)
    const expiryStr = getMembershipExpiry(anchor, duration, blackout, freezes)
    const monthOneBased = Number(today.split("-")[1])

    if (today < startStr) return { status: "NOT_STARTED", startStr, expiryStr }
    if (today >= expiryStr) return { status: "EXPIRED", startStr, expiryStr }
    if (isBlackoutMonth(monthOneBased, blackout)) return { status: "BLACKOUT", startStr, expiryStr }
    const freeze = findMembershipFreezeForDate(ticket, today)
    if (freeze) return { status: "FROZEN", startStr, expiryStr, freeze }
    return { status: "OK", startStr, expiryStr }
}

/**
 * ¿`today` cae dentro de la ventana vigente de una membresía a término fijo
 * (después del inicio, antes de la expiración y fuera del blackout)?
 */
export const isWithinMembershipWindow = (
    ticket: ScanTicket,
    today: string,
    blackout: readonly number[] = MEMBERSHIP_BLACKOUT_MONTHS
): boolean => getMembershipAccessStatus(ticket, today, blackout).status === "OK"

export type MembershipFreezeValidationResult =
    | { ok: true; range: MembershipFreezeMonthRange; membershipExpiry: string }
    | { ok: false; error: string }

export const validateMembershipFreezeMonth = (
    ticket: ScanTicket,
    month: string,
    now: Date = new Date(),
    blackout: readonly number[] = MEMBERSHIP_BLACKOUT_MONTHS
): MembershipFreezeValidationResult => {
    if (!isFixedTermMembership(ticket)) {
        return { ok: false, error: "Esta entrada no es una membresía congelable." }
    }
    if (ticket.status !== "ACTIVE") {
        return { ok: false, error: "La membresía no está activa." }
    }
    if (getMembershipFreezeRanges(ticket).length > 0) {
        return { ok: false, error: "Esta membresía ya usó su congelamiento." }
    }

    const range = getMembershipFreezeMonthRange(month)
    if (!range) {
        return { ok: false, error: "Selecciona un mes válido para congelar." }
    }

    const monthOneBased = Number(month.slice(5, 7))
    if (isBlackoutMonth(monthOneBased, blackout)) {
        return { ok: false, error: "Enero y febrero ya están restringidos y extendidos automáticamente." }
    }

    const startAt = startOfMonthInLimaAsUtc(month)
    if (!startAt) {
        return { ok: false, error: "Selecciona un mes válido para congelar." }
    }

    const todayStr = getLimaDateString(now)
    if (range.startStr <= todayStr) {
        return { ok: false, error: "No se aceptan congelamientos retroactivos o del mes en curso." }
    }

    const minNoticeMs = 48 * 60 * 60 * 1000
    if (startAt.getTime() - now.getTime() < minNoticeMs) {
        return { ok: false, error: "Solicita el congelamiento con al menos 48 horas de anticipación." }
    }

    const anchor = getMembershipAnchor(ticket)
    const duration = ticket.ticketType.membershipDurationMonths ?? 0
    if (!anchor || duration <= 0) {
        return { ok: false, error: "Membresía sin vigencia configurada." }
    }

    const membershipStart = formatDateUTC(anchor)
    const membershipExpiry = getMembershipExpiry(anchor, duration, blackout)
    if (range.startStr < membershipStart || range.endStr > membershipExpiry) {
        return {
            ok: false,
            error: `El mes debe estar completo dentro de la vigencia actual, desde ${dmy(membershipStart)} hasta antes del ${dmy(membershipExpiry)}.`,
        }
    }

    return { ok: true, range, membershipExpiry }
}

export const getEligibleMembershipFreezeMonths = (
    ticket: ScanTicket,
    now: Date = new Date(),
    maxMonthsAhead = 24
): MembershipFreezeMonthRange[] => {
    const { year, month } = getLimaDateParts(now)
    const currentMonth = `${year}-${pad2(month)}`
    const options: MembershipFreezeMonthRange[] = []

    for (let offset = 0; offset <= maxMonthsAhead; offset += 1) {
        const candidate = addMonthsToMonthKey(currentMonth, offset)
        const result = validateMembershipFreezeMonth(ticket, candidate, now)
        if (result.ok) options.push(result.range)
    }

    return options
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
    const anchor = getMembershipAnchor(ticket)
    const period = anchor ? getMembershipPeriod(today, anchor) : null
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
