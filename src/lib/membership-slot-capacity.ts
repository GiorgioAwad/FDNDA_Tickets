import { parseMembershipScheduleSelection, scheduleSelectionToInput, validateMembershipScheduleSelection, type MembershipScheduleProfile } from "@/lib/membership-schedule"

/** Counts reserved schedules, including pending payments, against each hour's limit. */
export function assertMembershipSlotCapacity(profile: MembershipScheduleProfile, schedules: unknown[]): void {
    const occupancy = new Map<string, number>()
    for (const raw of schedules) {
        const selection = parseMembershipScheduleSelection(raw)
        if (!selection || selection.profileKey !== profile.key || selection.groups.length === 0) {
            throw new Error("No se pudo verificar el cupo del horario de la membresía.")
        }
        const validated = validateMembershipScheduleSelection(profile, scheduleSelectionToInput(selection), selection.sucursalCode)
        if (!validated.ok) throw new Error("No se pudo verificar el cupo del horario de la membresía.")
        for (const group of selection.groups) {
            const key = `${selection.category}:${selection.frequency}:${group.id}:${group.start}:${group.end}`
            occupancy.set(key, (occupancy.get(key) ?? 0) + 1)
        }
    }
    for (const category of profile.categories) {
        for (const frequency of category.frequencies) {
            for (const group of frequency.dayGroups) {
                for (const hour of group.hours) {
                    const key = `${category.id}:${frequency.id}:${group.id}:${hour.start}:${hour.end}`
                    if (hour.capacity !== undefined && (occupancy.get(key) ?? 0) > hour.capacity) {
                        throw new Error(`El horario ${hour.start} a ${hour.end} está agotado. Selecciona otro horario.`)
                    }
                }
            }
        }
    }
}
