import { parseMembershipScheduleSelection, scheduleSelectionToInput, validateMembershipScheduleSelection, type MembershipScheduleProfile } from "@/lib/membership-schedule"

/** Clave estable de una franja dentro de un perfil: "<cat>:<frec>:<grupo>:<inicio>:<fin>". */
export function membershipSlotKey(category: string, frequency: string, groupId: string, start: string, end: string): string {
    return `${category}:${frequency}:${groupId}:${start}:${end}`
}

export interface MembershipLimitedSlot {
    key: string
    category: string
    categoryLabel: string
    frequency: string
    frequencyLabel: string
    groupId: string
    groupLabel: string
    start: string
    end: string
    /** Cupo del catálogo en código. */
    defaultCapacity: number
    /** Cupo vigente (catálogo o editado desde el admin). */
    capacity: number
}

export const MAX_MEMBERSHIP_SLOT_CAPACITY = 999

/** true si el perfil limita cupo por franja (hoy solo VERANO_3X). */
export function profileHasSlotCapacity(profile: MembershipScheduleProfile | null | undefined): profile is MembershipScheduleProfile {
    return Boolean(profile?.categories.some(c => c.frequencies.some(f => f.dayGroups.some(g => g.hours.some(h => h.capacity !== undefined)))))
}

/** Lee el JSON guardado en TicketType.membershipSlotCapacities; descarta lo que no sea entero >= 0. */
export function parseSlotCapacityOverrides(raw: unknown): Record<string, number> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
    const result: Record<string, number> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_MEMBERSHIP_SLOT_CAPACITY) result[key] = value
    }
    return result
}

/**
 * Devuelve una COPIA del perfil con los cupos editados aplicados. Solo se
 * sobreescriben franjas que ya tienen cupo en el catálogo: activar cupo en
 * perfiles sin tope (BRONCE/PLATA) haría que un horario excepcional bloquee
 * todas las ventas del plan.
 */
export function applySlotCapacityOverrides(profile: MembershipScheduleProfile, rawOverrides: unknown): MembershipScheduleProfile {
    const overrides = parseSlotCapacityOverrides(rawOverrides)
    if (Object.keys(overrides).length === 0) return profile
    return {
        ...profile,
        categories: profile.categories.map(category => ({
            ...category,
            frequencies: category.frequencies.map(frequency => ({
                ...frequency,
                dayGroups: frequency.dayGroups.map(group => ({
                    ...group,
                    hours: group.hours.map(hour => {
                        if (hour.capacity === undefined) return hour
                        const override = overrides[membershipSlotKey(category.id, frequency.id, group.id, hour.start, hour.end)]
                        return override === undefined ? hour : { ...hour, capacity: override }
                    }),
                })),
            })),
        })),
    }
}

/** Franjas con cupo del perfil, con el cupo del catálogo y el vigente. Ordenadas por hora. */
export function listMembershipLimitedSlots(profile: MembershipScheduleProfile, rawOverrides?: unknown): MembershipLimitedSlot[] {
    const overrides = parseSlotCapacityOverrides(rawOverrides)
    const slots: MembershipLimitedSlot[] = []
    for (const category of profile.categories) {
        for (const frequency of category.frequencies) {
            for (const group of frequency.dayGroups) {
                for (const hour of group.hours) {
                    if (hour.capacity === undefined) continue
                    const key = membershipSlotKey(category.id, frequency.id, group.id, hour.start, hour.end)
                    slots.push({
                        key,
                        category: category.id,
                        categoryLabel: category.label,
                        frequency: frequency.id,
                        frequencyLabel: frequency.label,
                        groupId: group.id,
                        groupLabel: group.label,
                        start: hour.start,
                        end: hour.end,
                        defaultCapacity: hour.capacity,
                        capacity: overrides[key] ?? hour.capacity,
                    })
                }
            }
        }
    }
    return slots.sort((a, b) => a.start.localeCompare(b.start) || a.key.localeCompare(b.key))
}

/**
 * Máximo de ALUMNOS que caben en el plan con estos cupos. Un alumno ocupa una
 * franja en CADA grupo de días de su frecuencia (niños M-J-S: Mar/Jue + Sábado),
 * así que por (categoría, frecuencia) el tope es el grupo más chico; luego se
 * suman. Con un solo grupo por frecuencia equivale a sumar todas las franjas.
 */
export function maxMembershipStudents(slots: Array<Pick<MembershipLimitedSlot, "category" | "frequency" | "groupId" | "capacity">>): number {
    const byFrequency = new Map<string, Map<string, number>>()
    for (const slot of slots) {
        const freqKey = `${slot.category}:${slot.frequency}`
        const groups = byFrequency.get(freqKey) ?? new Map<string, number>()
        groups.set(slot.groupId, (groups.get(slot.groupId) ?? 0) + slot.capacity)
        byFrequency.set(freqKey, groups)
    }
    let total = 0
    for (const groups of byFrequency.values()) total += Math.min(...groups.values())
    return total
}

/**
 * Totales del plan en ALUMNOS (no en franjas) para el panel admin. Cada alumno
 * reserva una franja por grupo de días, así que pagados/pendientes se toman de un
 * solo grupo por frecuencia y cupo/libres del grupo más chico.
 */
export function summarizeMembershipSlotsByStudent(
    rows: Array<{ category: string; frequency: string; groupId: string; capacity: number; paid: number; pending: number }>
): { capacity: number; paid: number; pending: number; available: number } {
    type Sums = { capacity: number; paid: number; pending: number; available: number }
    const byFrequency = new Map<string, Map<string, Sums>>()
    for (const row of rows) {
        const freqKey = `${row.category}:${row.frequency}`
        const groups = byFrequency.get(freqKey) ?? new Map<string, Sums>()
        const sums = groups.get(row.groupId) ?? { capacity: 0, paid: 0, pending: 0, available: 0 }
        sums.capacity += row.capacity
        sums.paid += row.paid
        sums.pending += row.pending
        sums.available += Math.max(row.capacity - row.paid - row.pending, 0)
        groups.set(row.groupId, sums)
        byFrequency.set(freqKey, groups)
    }
    const total = { capacity: 0, paid: 0, pending: 0, available: 0 }
    for (const groups of byFrequency.values()) {
        const list = [...groups.values()]
        total.capacity += Math.min(...list.map(g => g.capacity))
        total.paid += Math.max(...list.map(g => g.paid))
        total.pending += Math.max(...list.map(g => g.pending))
        total.available += Math.min(...list.map(g => g.available))
    }
    return total
}

/**
 * Cuenta reservas por franja. Los horarios que no se pueden leer o no validan
 * contra el catálogo se cuentan aparte en `invalid` (no se descartan en silencio).
 */
export function countMembershipSlotReservations(profile: MembershipScheduleProfile, schedules: unknown[]): { occupancy: Map<string, number>; invalid: number } {
    const occupancy = new Map<string, number>()
    let invalid = 0
    for (const raw of schedules) {
        const selection = parseMembershipScheduleSelection(raw)
        if (!selection || selection.profileKey !== profile.key || selection.groups.length === 0) { invalid++; continue }
        const validated = validateMembershipScheduleSelection(profile, scheduleSelectionToInput(selection), selection.sucursalCode)
        if (!validated.ok) { invalid++; continue }
        for (const group of selection.groups) {
            const key = membershipSlotKey(selection.category, selection.frequency, group.id, group.start, group.end)
            occupancy.set(key, (occupancy.get(key) ?? 0) + 1)
        }
    }
    return { occupancy, invalid }
}

/** Counts reserved schedules, including pending payments, against each hour's limit. */
export function assertMembershipSlotCapacity(profile: MembershipScheduleProfile, schedules: unknown[]): void {
    const { occupancy, invalid } = countMembershipSlotReservations(profile, schedules)
    if (invalid > 0) throw new Error("No se pudo verificar el cupo del horario de la membresía.")
    for (const slot of listMembershipLimitedSlots(profile)) {
        if ((occupancy.get(slot.key) ?? 0) > slot.capacity) {
            throw new Error(`El horario ${slot.start} a ${slot.end} está agotado. Selecciona otro horario.`)
        }
    }
}
