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

/**
 * Validación compartida (cliente + servidor) de la fecha de inicio elegida para
 * una membresía a término fijo. `todayStr` y `dateStr` son "YYYY-MM-DD" en hora
 * Lima. Reglas: formato válido, fecha real, no en mes blackout, no anterior a
 * hoy, y dentro de la ventana forward permitida.
 */
export const validateMembershipStartDate = (
    dateStr: string | null | undefined,
    todayStr: string,
    blackout: readonly number[] = MEMBERSHIP_BLACKOUT_MONTHS
): { ok: true } | { ok: false; error: string } => {
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
    if (dateStr < todayStr) {
        return { ok: false, error: "La fecha de inicio no puede ser anterior a hoy." }
    }
    if (dateStr > addMonthsToDateStr(todayStr, MEMBERSHIP_START_MAX_MONTHS_AHEAD)) {
        return { ok: false, error: "La fecha de inicio es demasiado lejana." }
    }
    return { ok: true }
}
