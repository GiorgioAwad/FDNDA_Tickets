import { getMembershipScheduleProfile } from "@/lib/membership-schedule"
import { SUMMER_MEMBERSHIP_SCHEDULE_KEY } from "@/lib/membership-config"

/** Canonical NATACION LMV codes, verified against the ABIO catalogue. */
const CODES_BY_START: Record<string, string> = {
    "06:00": "000001", "07:00": "000002", "08:00": "000003", "09:00": "000004",
    "10:00": "000005", "11:00": "000006", "12:00": "000007", "13:00": "000008",
    "14:00": "000009", "15:00": "000010", "16:00": "000011", "17:00": "000012",
    "18:00": "000013", "19:00": "000077", "20:00": "000148",
}

export const SUMMER_ABIO_SERVICE_CODE = "K14"
export const SUMMER_ABIO_DISCIPLINE_CODE = "00"
export const SUMMER_ABIO_POOL_CODE = "01"

const summerProfile = getMembershipScheduleProfile("01", SUMMER_MEMBERSHIP_SCHEDULE_KEY)!

/**
 * Franja que ABIO recibe por alumno: la hora del PRIMER grupo de días de la
 * frecuencia (L-M-V: única; M-J-S adultos: única; M-J-S niños: Mar/Jue, el
 * sábado no cambia el código). Ver resolveAcademiaAbioSchedule.
 */
const abioRowsFor = (frequencyId: string) => summerProfile.categories.flatMap(category =>
    category.frequencies.filter(f => f.id === frequencyId).flatMap(frequency =>
        frequency.dayGroups[0].hours.map(hour => ({
            category: category.id, categoryLabel: category.label, frequency: frequency.id,
            groupLabel: frequency.dayGroups[0].label,
            start: hour.start, end: hour.end, capacity: hour.capacity!,
        }))))

/** L-M-V (aplicado en prod el 2026-11-17 con configure-summer-abio-2027.ts). */
export const SUMMER_ABIO_SCHEDULES = abioRowsFor("LMV").map(row => ({ ...row, scheduleCode: CODES_BY_START[row.start] }))

/**
 * NATACION "Mar Jue Sab" (martes+jueves+sábado, sin L/X/V/D), verificados contra el
 * catálogo ABIO el 2026-11-19 (dry-run de add-summer-mjs-2027.ts). Donde el
 * catálogo tiene dos series para la misma franja (11:00 → 000018/000208;
 * 14:00-17:00 → 000039-42/000348-51) se usa la serie original (la más baja), igual
 * que en L-M-V. Adultos 6:00/7:00; niños = hora de Mar/Jue.
 */
const MJS_CODES_BY_START: Record<string, string> = {
    "06:00": "000075", "07:00": "000014", "08:00": "000015", "09:00": "000016",
    "10:00": "000017", "11:00": "000018", "12:00": "000019", "13:00": "000020",
    "14:00": "000039", "15:00": "000040", "16:00": "000041", "17:00": "000042",
    "18:00": "000076",
}

/** M-J-S (lo aplica add-summer-mjs-2027.ts, que re-verifica cada código contra el catálogo). */
export const SUMMER_ABIO_MJS_SCHEDULES = abioRowsFor("MJS").map(row => ({ ...row, scheduleCode: MJS_CODES_BY_START[row.start] }))

export const summerAbioMappingKey = (row: { category: string; frequency: string; start: string; end: string }) =>
    `${row.category}:${row.frequency}:${row.start}-${row.end}`

export const SUMMER_ABIO_EXTRA_CONFIG = {
    membershipSchedules: {
        profileKey: SUMMER_MEMBERSHIP_SCHEDULE_KEY,
        serviceStartDate: "2027-01-01",
        codes: Object.fromEntries(SUMMER_ABIO_SCHEDULES.map(row => [summerAbioMappingKey(row), row.scheduleCode])),
    },
}
