/**
 * Horario semanal fijo de membresías de natación (BRONCE / PLATA).
 *
 * A diferencia del modelo de horario por fecha concreta (`ticket-schedule.ts`,
 * usado por piscina/evento), esto es un patrón RECURRENTE por día-de-semana +
 * franja horaria que el alumno elige una vez en el checkout y que el escáner
 * hace cumplir de forma estricta durante toda la membresía ("se respeta y no se
 * cambia").
 *
 * El catálogo de horarios vive aquí en código (forward-compat): la matriz se
 * indexa por sede (`Event.servilexSucursalCode`: "01" Campo de Marte, "03"
 * VIDENA) y por una clave de perfil (`TicketType.membershipScheduleKey`) que
 * codifica categoría (adultos/niños) + plan (BRONCE elige frecuencia / PLATA
 * frecuencia fija L-V).
 *
 * Módulo PURO (sin Prisma ni env): compartido por checkout (cliente), validación
 * de pedido y escáner (servidor) y por los tests. Mismo estilo que
 * `membership-config.ts`.
 */

// Convención de día de semana = JS Date.getDay(): Dom=0, Lun=1 … Sáb=6.
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Franja de una hora "HH:MM"–"HH:MM" (24h). */
export interface HourSlot {
    start: string
    end: string
}

/**
 * Grupo de días que comparten el mismo conjunto de horas elegibles y para el que
 * el alumno hace UNA selección de hora. Ej. en M-J-S: "Mar y Jue" (un grupo) y
 * "Sábado" (otro grupo, con horas distintas).
 */
export interface ScheduleDayGroup {
    id: string
    label: string
    weekdays: Weekday[]
    hours: HourSlot[]
}

export type ScheduleFrequencyId = "LMV" | "MJS" | "LV"

export interface ScheduleFrequencyOption {
    id: ScheduleFrequencyId
    label: string
    dayGroups: ScheduleDayGroup[]
}

export type SchedulePlanMode = "CHOOSE_FREQUENCY" | "FIXED_FREQUENCY"

export type ScheduleCategoryId = "ADULTOS" | "NINOS"

/**
 * Categoría (adultos / niños) DENTRO de un plan. La categoría la elige el
 * comprador en el checkout (no el admin): define qué frecuencias/horas aplican.
 */
export interface ScheduleCategoryOption {
    id: ScheduleCategoryId
    label: string
    frequencies: ScheduleFrequencyOption[]
}

/**
 * Perfil de horario = un PLAN (BRONCE / PLATA). Lo elige el admin por entrada
 * (`membershipScheduleKey`). Contiene ambas categorías; el comprador elige la
 * suya en el checkout.
 */
export interface MembershipScheduleProfile {
    key: string
    label: string
    planMode: SchedulePlanMode
    categories: ScheduleCategoryOption[]
}

// ── Selección normalizada (lo que se guarda en Ticket.membershipSchedule) ──────

/** Una sesión semanal concreta: día + franja. El escáner valida contra estas. */
export interface MembershipScheduleSession {
    weekday: Weekday
    start: string
    end: string
}

/** Hora elegida por grupo, para mostrar en el carnet. */
export interface MembershipScheduleGroupChoice {
    id: string
    label: string
    weekdays: Weekday[]
    start: string
    end: string
}

export interface MembershipScheduleSelection {
    profileKey: string
    sucursalCode: string
    category: ScheduleCategoryId
    categoryLabel: string
    frequency: ScheduleFrequencyId
    frequencyLabel: string
    sessions: MembershipScheduleSession[]
    groups: MembershipScheduleGroupChoice[]
}

/** Entrada cruda desde el checkout: categoría + frecuencia + hora por grupo. */
export interface MembershipScheduleInput {
    category?: string | null
    frequency?: string | null
    hours?: Record<string, string> | null
}

/**
 * Tolerancia (minutos) para el escáner: se permite ingresar desde
 * `inicio - GRACE` y hasta el `fin` de la franja. Fuera de eso el QR se rechaza
 * (con override de emergencia Staff/Admin).
 */
export const MEMBERSHIP_SCAN_GRACE_MINUTES = 15

// ── Catálogo de horas (helpers internos para armar la matriz) ──────────────────

const slot = (start: string, end: string): HourSlot => ({ start, end })

// Campo de Marte — adultos: 6am–3pm corrido + 6pm–9pm (sin cierre de almuerzo,
// confirmado por el usuario).
const CM_ADULT_HOURS: HourSlot[] = [
    slot("06:00", "07:00"),
    slot("07:00", "08:00"),
    slot("08:00", "09:00"),
    slot("09:00", "10:00"),
    slot("10:00", "11:00"),
    slot("11:00", "12:00"),
    slot("12:00", "13:00"),
    slot("13:00", "14:00"),
    slot("14:00", "15:00"),
    slot("18:00", "19:00"),
    slot("19:00", "20:00"),
    slot("20:00", "21:00"),
]
// Campo de Marte — adultos M-J-S sábado: solo 6-7 y 7-8am.
const CM_ADULT_SAT_HOURS: HourSlot[] = [slot("06:00", "07:00"), slot("07:00", "08:00")]
// Campo de Marte — niños: 3pm–6pm.
const CM_KIDS_HOURS: HourSlot[] = [slot("15:00", "16:00"), slot("16:00", "17:00"), slot("17:00", "18:00")]
// Campo de Marte — niños M-J-S sábado: 8am–2pm.
const CM_KIDS_SAT_HOURS: HourSlot[] = [
    slot("08:00", "09:00"),
    slot("09:00", "10:00"),
    slot("10:00", "11:00"),
    slot("11:00", "12:00"),
    slot("12:00", "13:00"),
    slot("13:00", "14:00"),
]

// VIDENA — adultos estándar (filas de adultos del cuadro): 6–11am, 1–3pm, 7–10pm
// (11am–1pm cerrado). El 9–10pm se agregó a pedido (aplica a BRONCE y PLATA adultos).
const VID_ADULT_HOURS: HourSlot[] = [
    slot("06:00", "07:00"),
    slot("07:00", "08:00"),
    slot("08:00", "09:00"),
    slot("09:00", "10:00"),
    slot("10:00", "11:00"),
    slot("13:00", "14:00"),
    slot("14:00", "15:00"),
    slot("19:00", "20:00"),
    slot("20:00", "21:00"),
    slot("21:00", "22:00"),
]
// VIDENA — tarde (3–7pm), franja de niños del cuadro.
const VID_AFTERNOON_HOURS: HourSlot[] = [
    slot("15:00", "16:00"),
    slot("16:00", "17:00"),
    slot("17:00", "18:00"),
    slot("18:00", "19:00"),
]
// VIDENA — adultos M-J-S Mar/Jue: mañana/estándar + tarde (confirmado por el
// usuario: además del turno tarde de la nota, se mantiene la mañana).
const VID_ADULT_MJS_WEEKDAY_HOURS: HourSlot[] = [...VID_ADULT_HOURS, ...VID_AFTERNOON_HOURS]
// VIDENA — sábado M-J-S (nota al pie del cuadro): 8am–1pm.
const VID_SAT_HOURS: HourSlot[] = [
    slot("08:00", "09:00"),
    slot("09:00", "10:00"),
    slot("10:00", "11:00"),
    slot("11:00", "12:00"),
    slot("12:00", "13:00"),
]

const FREQ_LABEL: Record<ScheduleFrequencyId, string> = {
    LMV: "Lunes, Miércoles y Viernes",
    MJS: "Martes, Jueves y Sábado",
    LV: "Lunes a Viernes",
}

// Constructores de frecuencias reutilizables.
const lmv = (hours: HourSlot[]): ScheduleFrequencyOption => ({
    id: "LMV",
    label: FREQ_LABEL.LMV,
    dayGroups: [{ id: "main", label: "Lunes, Miércoles y Viernes", weekdays: [1, 3, 5], hours }],
})

const mjs = (weekdayHours: HourSlot[], saturdayHours: HourSlot[]): ScheduleFrequencyOption => ({
    id: "MJS",
    label: FREQ_LABEL.MJS,
    dayGroups: [
        { id: "weekday", label: "Martes y Jueves", weekdays: [2, 4], hours: weekdayHours },
        { id: "saturday", label: "Sábado", weekdays: [6], hours: saturdayHours },
    ],
})

const lv = (hours: HourSlot[]): ScheduleFrequencyOption => ({
    id: "LV",
    label: FREQ_LABEL.LV,
    dayGroups: [{ id: "main", label: "Lunes a Viernes", weekdays: [1, 2, 3, 4, 5], hours }],
})

const CATEGORY_LABEL: Record<ScheduleCategoryId, string> = {
    ADULTOS: "Adultos",
    NINOS: "Niños (6 a 17 años)",
}

const category = (id: ScheduleCategoryId, frequencies: ScheduleFrequencyOption[]): ScheduleCategoryOption => ({
    id,
    label: CATEGORY_LABEL[id],
    frequencies,
})

// BRONCE = interdiario (elige frecuencia L-M-V o M-J-S). Una entrada se vende a
// adultos y niños; el comprador elige su categoría en el checkout.
const bronce = (
    adultLmv: ScheduleFrequencyOption,
    adultMjs: ScheduleFrequencyOption,
    kidLmv: ScheduleFrequencyOption,
    kidMjs: ScheduleFrequencyOption
): MembershipScheduleProfile => ({
    key: "BRONCE",
    label: "BRONCE (interdiario)",
    planMode: "CHOOSE_FREQUENCY",
    categories: [category("ADULTOS", [adultLmv, adultMjs]), category("NINOS", [kidLmv, kidMjs])],
})

// PLATA = diario (Lun a Vie), solo elige hora.
const plata = (adultLv: ScheduleFrequencyOption, kidLv: ScheduleFrequencyOption): MembershipScheduleProfile => ({
    key: "PLATA",
    label: "PLATA (Lun a Vie)",
    planMode: "FIXED_FREQUENCY",
    categories: [category("ADULTOS", [adultLv]), category("NINOS", [kidLv])],
})

/** Claves de perfil disponibles (= plan; la categoría se elige en checkout). */
export const MEMBERSHIP_SCHEDULE_KEYS = ["BRONCE", "PLATA"] as const
export type MembershipScheduleKey = (typeof MEMBERSHIP_SCHEDULE_KEYS)[number]

// Compatibilidad con claves antiguas (categoría + plan) por si quedó alguna
// entrada configurada antes de mover la categoría al checkout.
const LEGACY_KEY_ALIASES: Record<string, MembershipScheduleKey> = {
    ADULTOS_BRONCE: "BRONCE",
    NINOS_BRONCE: "BRONCE",
    ADULTOS_PLATA: "PLATA",
    NINOS_PLATA: "PLATA",
}

/**
 * Matriz sede → plan → perfil de horario. Para agregar una sede nueva basta con
 * añadir su `servilexSucursalCode` aquí.
 */
export const MEMBERSHIP_SCHEDULES: Record<string, Partial<Record<MembershipScheduleKey, MembershipScheduleProfile>>> = {
    // Campo de Marte
    "01": {
        BRONCE: bronce(
            lmv(CM_ADULT_HOURS),
            mjs(CM_ADULT_HOURS, CM_ADULT_SAT_HOURS),
            lmv(CM_KIDS_HOURS),
            mjs(CM_KIDS_HOURS, CM_KIDS_SAT_HOURS)
        ),
        PLATA: plata(lv(CM_ADULT_HOURS), lv(CM_KIDS_HOURS)),
    },
    // VIDENA
    "03": {
        BRONCE: bronce(
            lmv(VID_ADULT_HOURS),
            mjs(VID_ADULT_MJS_WEEKDAY_HOURS, VID_SAT_HOURS),
            lmv(VID_AFTERNOON_HOURS),
            mjs(VID_AFTERNOON_HOURS, VID_SAT_HOURS)
        ),
        PLATA: plata(lv(VID_ADULT_HOURS), lv(VID_AFTERNOON_HOURS)),
    },
}

/** Sedes que tienen catálogo de horarios configurado. */
export const MEMBERSHIP_SCHEDULE_SUCURSALES = Object.keys(MEMBERSHIP_SCHEDULES)

/**
 * Devuelve el perfil de horario para una sede + clave, o null si no aplica
 * (sede sin catálogo, clave vacía/desconocida → la membresía no usa horario
 * semanal y cae a la ruta legacy).
 */
export function getMembershipScheduleProfile(
    sucursalCode: string | null | undefined,
    scheduleKey: string | null | undefined
): MembershipScheduleProfile | null {
    if (!sucursalCode || !scheduleKey) return null
    const resolvedKey = LEGACY_KEY_ALIASES[scheduleKey] ?? (scheduleKey as MembershipScheduleKey)
    return MEMBERSHIP_SCHEDULES[sucursalCode]?.[resolvedKey] ?? null
}

/** Claves válidas para una sede (para poblar el dropdown del admin). */
export function getMembershipScheduleKeysForSucursal(sucursalCode: string | null | undefined): MembershipScheduleKey[] {
    if (!sucursalCode) return []
    const profiles = MEMBERSHIP_SCHEDULES[sucursalCode]
    if (!profiles) return []
    return MEMBERSHIP_SCHEDULE_KEYS.filter((key) => Boolean(profiles[key]))
}

// ── Formato / labels ──────────────────────────────────────────────────────────

const HHMM_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/

function toMinutes(hhmm: string): number | null {
    const match = HHMM_REGEX.exec(hhmm)
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
}

/** "13:00" → "1:00 p.m." (formato peruano). */
export function formatTime12h(hhmm: string): string {
    const match = HHMM_REGEX.exec(hhmm)
    if (!match) return hhmm
    const h = Number(match[1])
    const m = match[2]
    const ampm = h < 12 ? "a.m." : "p.m."
    let h12 = h % 12
    if (h12 === 0) h12 = 12
    return `${h12}:${m} ${ampm}`
}

/** Franja → "9:00 a.m. – 10:00 a.m." */
export function formatSlotLabel(s: HourSlot): string {
    return `${formatTime12h(s.start)} – ${formatTime12h(s.end)}`
}

/** Valor canónico de una franja para selects/almacenamiento: "HH:MM-HH:MM". */
export function slotToValue(s: HourSlot): string {
    return `${s.start}-${s.end}`
}

function parseSlotValue(value: string | null | undefined): HourSlot | null {
    if (typeof value !== "string") return null
    const [start, end] = value.split("-")
    if (!start || !end || toMinutes(start) === null || toMinutes(end) === null) return null
    return { start, end }
}

// ── Validación + normalización de la selección ─────────────────────────────────

type ValidateResult =
    | { ok: true; selection: MembershipScheduleSelection }
    | { ok: false; error: string }

/**
 * Valida la selección de horario contra el perfil y devuelve la versión
 * normalizada lista para guardar en `Ticket.membershipSchedule`. Compartido por
 * checkout (cliente) y `api/orders` (servidor).
 *
 *  - La categoría debe existir en el perfil (ADULTOS / NINOS) — elegida en checkout.
 *  - La frecuencia debe existir en esa categoría (BRONCE: LMV o MJS; PLATA: LV).
 *  - Cada grupo de días de esa frecuencia debe tener una hora elegida que
 *    pertenezca a las horas permitidas del grupo.
 */
export function validateMembershipScheduleSelection(
    profile: MembershipScheduleProfile,
    input: MembershipScheduleInput | null | undefined,
    sucursalCode: string
): ValidateResult {
    const categoryId = typeof input?.category === "string" ? input.category.trim() : ""
    const freqId = typeof input?.frequency === "string" ? input.frequency.trim() : ""
    const hours = input?.hours && typeof input.hours === "object" ? input.hours : {}

    const category = profile.categories.find((c) => c.id === categoryId)
    if (!category) {
        return { ok: false, error: "Indica si la membresía es para adulto o niño." }
    }

    const frequency = category.frequencies.find((f) => f.id === freqId)
    if (!frequency) {
        return {
            ok: false,
            error:
                profile.planMode === "CHOOSE_FREQUENCY"
                    ? "Selecciona la frecuencia de tu membresía (interdiaria)."
                    : "No se pudo determinar la frecuencia de tu membresía.",
        }
    }

    const sessions: MembershipScheduleSession[] = []
    const groups: MembershipScheduleGroupChoice[] = []

    for (const group of frequency.dayGroups) {
        const chosen = parseSlotValue(hours[group.id])
        if (!chosen) {
            return { ok: false, error: `Selecciona el horario para ${group.label}.` }
        }
        const allowed = group.hours.find((h) => h.start === chosen.start && h.end === chosen.end)
        if (!allowed) {
            return { ok: false, error: `El horario elegido para ${group.label} no está disponible.` }
        }
        for (const weekday of group.weekdays) {
            sessions.push({ weekday, start: allowed.start, end: allowed.end })
        }
        groups.push({
            id: group.id,
            label: group.label,
            weekdays: group.weekdays,
            start: allowed.start,
            end: allowed.end,
        })
    }

    return {
        ok: true,
        selection: {
            profileKey: profile.key,
            sucursalCode,
            category: category.id,
            categoryLabel: category.label,
            frequency: frequency.id,
            frequencyLabel: frequency.label,
            sessions,
            groups,
        },
    }
}

/**
 * Re-hidrata una selección guardada (JSON de `Ticket.membershipSchedule`) a la
 * forma tipada, descartando lo malformado. Devuelve null si no hay sesiones
 * válidas.
 */
export function parseMembershipScheduleSelection(value: unknown): MembershipScheduleSelection | null {
    if (!value || typeof value !== "object") return null
    const record = value as Record<string, unknown>
    const rawSessions = Array.isArray(record.sessions) ? record.sessions : []
    const sessions: MembershipScheduleSession[] = []
    for (const item of rawSessions) {
        if (!item || typeof item !== "object") continue
        const s = item as Record<string, unknown>
        const weekday = typeof s.weekday === "number" ? s.weekday : NaN
        const start = typeof s.start === "string" ? s.start : ""
        const end = typeof s.end === "string" ? s.end : ""
        if (weekday < 0 || weekday > 6 || toMinutes(start) === null || toMinutes(end) === null) continue
        sessions.push({ weekday: weekday as Weekday, start, end })
    }
    if (sessions.length === 0) return null

    const rawGroups = Array.isArray(record.groups) ? record.groups : []
    const groups: MembershipScheduleGroupChoice[] = []
    for (const item of rawGroups) {
        if (!item || typeof item !== "object") continue
        const g = item as Record<string, unknown>
        const start = typeof g.start === "string" ? g.start : ""
        const end = typeof g.end === "string" ? g.end : ""
        if (toMinutes(start) === null || toMinutes(end) === null) continue
        groups.push({
            id: typeof g.id === "string" ? g.id : "",
            label: typeof g.label === "string" ? g.label : "",
            weekdays: Array.isArray(g.weekdays) ? (g.weekdays.filter((w) => typeof w === "number") as Weekday[]) : [],
            start,
            end,
        })
    }

    return {
        profileKey: typeof record.profileKey === "string" ? record.profileKey : "",
        sucursalCode: typeof record.sucursalCode === "string" ? record.sucursalCode : "",
        category: (record.category === "NINOS" ? "NINOS" : "ADULTOS") as ScheduleCategoryId,
        categoryLabel: typeof record.categoryLabel === "string" ? record.categoryLabel : "",
        frequency: (typeof record.frequency === "string" ? record.frequency : "LMV") as ScheduleFrequencyId,
        frequencyLabel: typeof record.frequencyLabel === "string" ? record.frequencyLabel : "",
        sessions,
        groups,
    }
}

// ── Horario efectivo por mes (cambio mensual) ─────────────────────────────────

/** Un punto de cambio: el horario elegido para un mes concreto de la membresía. */
export interface MembershipScheduleOverride {
    monthIndex: number
    selection: MembershipScheduleSelection | null
}

/**
 * Horario efectivo de un mes de la membresía: el override válido con mayor
 * `monthIndex` ≤ `monthIndex`, o el `base` (checkout) si no hay ninguno antes.
 * Implementa "heredar el mes anterior": un cambio en el mes N rige N, N+1, …
 * hasta el siguiente cambio. Función pura (no toca DB).
 */
export function getEffectiveMembershipSchedule(
    base: MembershipScheduleSelection | null,
    overrides: MembershipScheduleOverride[],
    monthIndex: number
): MembershipScheduleSelection | null {
    let best: { monthIndex: number; selection: MembershipScheduleSelection } | null = null
    for (const o of overrides) {
        if (
            o.selection &&
            o.monthIndex <= monthIndex &&
            (best === null || o.monthIndex > best.monthIndex)
        ) {
            best = { monthIndex: o.monthIndex, selection: o.selection }
        }
    }
    return best?.selection ?? base
}

/** Texto legible de una selección de horario (frecuencia + franjas por grupo). */
export function formatScheduleSummary(selection: MembershipScheduleSelection | null): string {
    if (!selection) return "—"
    const parts = selection.groups.map(
        (g) => `${g.label}: ${formatSlotLabel({ start: g.start, end: g.end })}`
    )
    return parts.length > 0 ? `${selection.frequencyLabel} · ${parts.join(" · ")}` : selection.frequencyLabel
}

/** Convierte una selección normalizada a la forma de input del selector (UI). */
export function scheduleSelectionToInput(
    selection: MembershipScheduleSelection | null
): MembershipScheduleInput {
    if (!selection) return { category: null, frequency: null, hours: {} }
    const hours: Record<string, string> = {}
    for (const g of selection.groups) hours[g.id] = `${g.start}-${g.end}`
    return { category: selection.category, frequency: selection.frequency, hours }
}

// ── Enforcement (escáner) ──────────────────────────────────────────────────────

export type SessionMatchResult =
    | { ok: true; session: MembershipScheduleSession }
    | { ok: false; reason: "WRONG_DAY" }
    | { ok: false; reason: "WRONG_TIME"; session: MembershipScheduleSession }

/**
 * ¿El escaneo (día de semana + hora "HH:MM" en Lima) cae dentro de alguna sesión
 * del horario elegido? Se permite desde `inicio - grace` hasta `fin`.
 *  - Ningún día coincide → WRONG_DAY.
 *  - El día coincide pero la hora está fuera → WRONG_TIME (con la sesión del día).
 */
export function matchMembershipSession(
    sessions: MembershipScheduleSession[],
    weekday: number,
    timeHHMM: string,
    graceMinutes: number = MEMBERSHIP_SCAN_GRACE_MINUTES
): SessionMatchResult {
    const daySessions = sessions.filter((s) => s.weekday === weekday)
    if (daySessions.length === 0) {
        return { ok: false, reason: "WRONG_DAY" }
    }
    const now = toMinutes(timeHHMM)
    if (now === null) {
        // Sin hora válida no podemos validar la franja: aceptamos por día (no
        // bloqueamos por un fallo de reloj).
        return { ok: true, session: daySessions[0] }
    }
    for (const session of daySessions) {
        const startMin = toMinutes(session.start)
        const endMin = toMinutes(session.end)
        if (startMin === null || endMin === null) continue
        if (now >= startMin - graceMinutes && now <= endMin) {
            return { ok: true, session }
        }
    }
    return { ok: false, reason: "WRONG_TIME", session: daySessions[0] }
}

const WEEKDAY_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]

/** "Mar, Jue, Sáb" a partir de los weekdays de las sesiones (orden Lun→Dom). */
export function formatSessionsDaysLabel(sessions: MembershipScheduleSession[]): string {
    const order = [1, 2, 3, 4, 5, 6, 0]
    const present = new Set(sessions.map((s) => s.weekday))
    return order
        .filter((w) => present.has(w as Weekday))
        .map((w) => WEEKDAY_SHORT[w])
        .join(", ")
}

/**
 * Día de la semana (0-6) de una fecha "YYYY-MM-DD". Se ancla a mediodía UTC para
 * evitar off-by-one (ver memorias scan_date_dbdate_utc / scan_today_lima_tz). La
 * fecha ya viene calculada en hora Lima (getTodayDateString).
 */
export function weekdayFromDateKey(dateKey: string): Weekday {
    const [y, m, d] = dateKey.split("-").map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() as Weekday
}
