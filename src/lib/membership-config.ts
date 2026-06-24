/**
 * Configuración de membresías a término fijo (anuales / semestrales).
 *
 * Blackout: meses (1-based) en los que la academia cierra y el QR de la
 * membresía no aplica. Durante estos meses la vigencia se CONGELA y se EXTIENDE
 * (no se pierden), ver scan-helpers.getMembershipExpiry.
 *
 * Hoy es una constante global (regla por términos y condiciones). Si en el
 * futuro se necesita variar por sede/evento, mover a una columna
 * `Event.membershipBlackoutMonths Json?` y pasarla por parámetro a los helpers
 * (que ya aceptan `blackout`).
 */
export const MEMBERSHIP_BLACKOUT_MONTHS: readonly number[] = [1, 2] // enero, febrero

/** ¿El mes (1-based) cae en el blackout de la membresía? */
export const isBlackoutMonth = (
    monthOneBased: number,
    blackout: readonly number[] = MEMBERSHIP_BLACKOUT_MONTHS
): boolean => blackout.includes(monthOneBased)

/** Máximo de meses hacia adelante que se permite elegir como fecha de inicio. */
export const MEMBERSHIP_START_MAX_MONTHS_AHEAD = 18

// Suma `months` a una fecha "YYYY-MM-DD" (string-based, clamp al último día del
// mes destino). Local al módulo para no depender de scan-helpers (evita ciclo).
const addMonthsToDateStr = (yyyyMmDd: string, months: number): string => {
    const [y, m, d] = yyyyMmDd.split("-").map(Number)
    const total = y * 12 + (m - 1) + months
    const ny = Math.floor(total / 12)
    const nm = (total % 12) + 1
    const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
    const nd = Math.min(d, lastDay)
    return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`
}

// "YYYY-MM-DD" -> "DD/MM/YYYY" para mensajes (string-based).
const dmy = (isoDate: string): string => {
    const [y, m, d] = isoDate.split("-")
    return y && m && d ? `${d}/${m}/${y}` : isoDate
}

/**
 * Configuración de la fecha de inicio de membresía a nivel evento. Fechas en
 * "YYYY-MM-DD" (o null). Resuelta por `resolveMembershipStartSetup`.
 */
export type MembershipStartConfig = {
    fixed?: string | null
    min?: string | null
    max?: string | null
}

export type MembershipStartSetup =
    | { mode: "fixed"; fixed: string }
    | { mode: "window"; min: string; max: string }
    | { mode: "default"; min: string; max: string }

/**
 * Resuelve cómo se elige la fecha de inicio según la config del evento:
 *  - fija  → todos inician ese día (sin selector).
 *  - rango → el comprador elige dentro de [min, max].
 *  - default → desde hoy hasta hoy + N meses.
 * Compartido por checkout (cliente) y validación de pedido (servidor).
 */
export const resolveMembershipStartSetup = (
    config: MembershipStartConfig | null | undefined,
    todayStr: string
): MembershipStartSetup => {
    if (config?.fixed) return { mode: "fixed", fixed: config.fixed }
    if (config?.min && config?.max) return { mode: "window", min: config.min, max: config.max }
    return {
        mode: "default",
        min: todayStr,
        max: addMonthsToDateStr(todayStr, MEMBERSHIP_START_MAX_MONTHS_AHEAD),
    }
}

/**
 * Validación compartida (cliente + servidor) de la fecha de inicio elegida para
 * una membresía a término fijo. `todayStr` y `dateStr` son "YYYY-MM-DD" en hora
 * Lima. Reglas: formato válido, fecha real, no en mes blackout, dentro de
 * [min, max]. Por defecto min=hoy y max=hoy + N meses; se pueden acotar con
 * `opts.min`/`opts.max` (ventana del evento).
 */
export const validateMembershipStartDate = (
    dateStr: string | null | undefined,
    todayStr: string,
    opts: { min?: string | null; max?: string | null; blackout?: readonly number[] } = {}
): { ok: true } | { ok: false; error: string } => {
    const blackout = opts.blackout ?? MEMBERSHIP_BLACKOUT_MONTHS
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return { ok: false, error: "Selecciona la fecha de inicio de tu membresía." }
    }
    const [y, m, d] = dateStr.split("-").map(Number)
    const probe = new Date(Date.UTC(y, m - 1, d))
    if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
        return { ok: false, error: "Fecha de inicio inválida." }
    }
    if (isBlackoutMonth(m, blackout)) {
        return { ok: false, error: "La membresía no puede iniciar en enero ni febrero." }
    }
    const min = opts.min || todayStr
    const max = opts.max || addMonthsToDateStr(todayStr, MEMBERSHIP_START_MAX_MONTHS_AHEAD)
    if (dateStr < min) {
        return {
            ok: false,
            error: opts.min
                ? `La fecha de inicio debe ser desde el ${dmy(min)}.`
                : "La fecha de inicio no puede ser anterior a hoy.",
        }
    }
    if (dateStr > max) {
        return {
            ok: false,
            error: opts.max
                ? `La fecha de inicio no puede ser posterior al ${dmy(max)}.`
                : "La fecha de inicio es demasiado lejana.",
        }
    }
    return { ok: true }
}
