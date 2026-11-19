import { getMembershipScheduleProfile, parseMembershipScheduleSelection, scheduleSelectionToInput, validateMembershipScheduleSelection } from "@/lib/membership-schedule"

const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null

export function hasMembershipAbioScheduleMapping(extraConfig: unknown): boolean {
    return Object.prototype.hasOwnProperty.call(record(extraConfig) ?? {}, "membershipSchedules")
}

/** Resolves from server-owned configuration and the validated student's schedule. */
export function resolveAcademiaAbioSchedule(input: {
    extraConfig: unknown
    scheduleCode: string | null | undefined
    selection: unknown
    sucursalCode: string
}): { scheduleCode: string; serviceDate: string | null } {
    if (!hasMembershipAbioScheduleMapping(input.extraConfig)) {
        if (!input.scheduleCode?.trim()) throw new Error("Falta el código de horario ABIO.")
        return { scheduleCode: input.scheduleCode.trim(), serviceDate: null }
    }
    const config = record(record(input.extraConfig)?.membershipSchedules)
    const codes = record(config?.codes)
    const selection = parseMembershipScheduleSelection(input.selection)
    const profileKey = typeof config?.profileKey === "string" ? config.profileKey : ""
    const profile = getMembershipScheduleProfile(input.sucursalCode, profileKey)
    if (!selection || !profile || selection.profileKey !== profileKey || selection.sucursalCode !== input.sucursalCode) {
        throw new Error("Selecciona un horario de membresía válido para ABIO.")
    }
    const checked = validateMembershipScheduleSelection(profile, scheduleSelectionToInput(selection), input.sucursalCode)
    if (!checked.ok || checked.selection.groups.length === 0) throw new Error("El horario de membresía no tiene una asociación ABIO válida.")
    // ABIO recibe UN código por alumno. Con varios grupos de días (niños de verano
    // M-J-S: Mar/Jue + Sábado) manda el primero (Mar/Jue); el sábado no cambia el código.
    const group = checked.selection.groups[0]
    const key = `${selection.category}:${selection.frequency}:${group.start}-${group.end}`
    const code = codes?.[key]
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) {
        throw new Error(`El horario ${group.start} a ${group.end} no tiene un código ABIO asociado.`)
    }
    const date = config?.serviceStartDate
    const probe = typeof date === "string" ? new Date(`${date}T12:00:00Z`) : null
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !probe || !Number.isFinite(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) {
        throw new Error("La fecha de inicio del servicio ABIO no es válida.")
    }
    return { scheduleCode: code, serviceDate: date }
}
