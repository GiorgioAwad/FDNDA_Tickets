/**
 * Ocupacion por franja horaria de las membresias de un evento.
 *
 * Responde "cuanta gente hay en cada franja" usando el horario EFECTIVO del mes
 * en curso: aplica los cambios mensuales (MembershipMonthlySchedule), no solo el
 * elegido en el checkout. Es lo que alimenta la vista /admin/membresias/cupos y
 * el selector de horario de la ficha, para no mandar a nadie a una franja llena.
 *
 * Modulo PURO: el llamador resuelve que carnets cuentan (ACTIVE, orden PAID,
 * vigentes hoy y no congelados) y en que `monthIndex` esta cada uno; aqui solo
 * se agrega.
 *
 * OJO: esto MUESTRA ocupacion, no la limita. El unico tope que se hace cumplir
 * en la venta es el global del TicketType (capacity / sold).
 */
import {
    formatTime12h,
    getEffectiveMembershipSchedule,
    getMembershipScheduleProfile,
    parseMembershipScheduleSelection,
    type MembershipScheduleSelection,
    type Weekday,
} from "@/lib/membership-schedule"

export interface OccupancyTicketSnapshot {
    id: string
    ticketTypeId: string
    ticketTypeName: string
    /** membershipScheduleKey del tipo. null en sedes sin catalogo (VMT). */
    planKey: string | null
    durationMonths?: number | null
    baseSchedule: unknown
    monthlySchedules: Array<{ monthIndex: number; selection: unknown }>
    /** Indice del mes en curso de ESE carnet (getMembershipPeriod().index). */
    monthIndex: number
    /** El llamador decide: ACTIVE, orden PAID, vigente hoy, no congelado. */
    counts: boolean
}

export interface OccupancyPlanTotalInput {
    ticketTypeId: string
    name: string
    capacity: number
    sold: number
    planKey?: string | null
    durationMonths?: number | null
    monthlyClassLimit?: number | null
    price?: number | null
    isActive?: boolean
}

export interface OccupancySlotRow {
    ticketTypeId: string
    ticketTypeName: string
    planKey: string | null
    category: string
    categoryLabel: string
    frequency: string
    frequencyLabel: string
    weekday: Weekday
    start: string
    end: string
    label: string
    enrolled: number
}

export interface OccupancyDayLoadCell {
    weekday: Weekday
    start: string
    end: string
    label: string
    total: number
}

export interface OccupancyPlanRow {
    ticketTypeId: string
    name: string
    capacity: number
    sold: number
    /** null = sin tope (capacity 0). */
    available: number | null
    planKey: string | null
    durationMonths: number | null
    monthlyClassLimit: number | null
    price: number | null
    isActive: boolean
    currentMembers: number
}

/** Catalog row for the group selected by a member, not each individual day. */
export interface OccupancyScheduleRow {
    ticketTypeId: string
    ticketTypeName: string
    planKey: string | null
    durationMonths: number | null
    category: string
    categoryLabel: string
    frequency: string
    frequencyLabel: string
    groupId: string
    groupLabel: string
    start: string
    end: string
    label: string
    enrolled: number
    capacityInPlan: number
    soldInPlan: number
    /** Global plan availability; this is not a per-slot limit. */
    availableInPlan: number | null
    currentMembersInPlan: number
    monthlyClassLimit: number | null
    price: number | null
    isActive: boolean
    status: "SCHEDULED" | "FREE_ACCESS" | "MISSING_SCHEDULE"
}

export interface MembershipOccupancy {
    slots: OccupancySlotRow[]
    dayLoad: OccupancyDayLoadCell[]
    planTotals: OccupancyPlanRow[]
    scheduleRows: OccupancyScheduleRow[]
    currentMembers: number
    missingSchedule: number
}

function slotLabel(start: string, end: string): string {
    return `${formatTime12h(start)} - ${formatTime12h(end)}`
}

function effectiveSelection(
    ticket: OccupancyTicketSnapshot
): MembershipScheduleSelection | null {
    const base = parseMembershipScheduleSelection(ticket.baseSchedule)
    const overrides = ticket.monthlySchedules.map((row) => ({
        monthIndex: row.monthIndex,
        selection: parseMembershipScheduleSelection(row.selection),
    }))
    return getEffectiveMembershipSchedule(base, overrides, ticket.monthIndex)
}

export function buildMembershipOccupancy(input: {
    tickets: OccupancyTicketSnapshot[]
    planTotals: OccupancyPlanTotalInput[]
    sucursalCode?: string | null
}): MembershipOccupancy {
    const slots = new Map<string, OccupancySlotRow>()
    const dayLoad = new Map<string, OccupancyDayLoadCell>()
    const selectedGroups = new Map<string, number>()
    const freeAccessByType = new Map<string, number>()
    const missingScheduleByType = new Map<string, number>()
    const currentMembersByType = new Map<string, number>()

    for (const ticket of input.tickets) {
        if (!ticket.counts) continue
        currentMembersByType.set(ticket.ticketTypeId, (currentMembersByType.get(ticket.ticketTypeId) ?? 0) + 1)
        const selection = effectiveSelection(ticket)
        if (!selection) {
            const target = ticket.planKey ? missingScheduleByType : freeAccessByType
            target.set(ticket.ticketTypeId, (target.get(ticket.ticketTypeId) ?? 0) + 1)
            continue
        }

        for (const group of selection.groups) {
            const groupKey = [
                ticket.ticketTypeId,
                selection.category,
                selection.frequency,
                group.id,
                group.start,
                group.end,
            ].join("|")
            selectedGroups.set(groupKey, (selectedGroups.get(groupKey) ?? 0) + 1)
        }

        for (const session of selection.sessions) {
            const slotKey = [
                ticket.ticketTypeId,
                selection.category,
                selection.frequency,
                session.weekday,
                session.start,
                session.end,
            ].join("|")
            const existing = slots.get(slotKey)
            if (existing) {
                existing.enrolled += 1
            } else {
                slots.set(slotKey, {
                    ticketTypeId: ticket.ticketTypeId,
                    ticketTypeName: ticket.ticketTypeName,
                    planKey: ticket.planKey,
                    category: selection.category,
                    categoryLabel: selection.categoryLabel,
                    frequency: selection.frequency,
                    frequencyLabel: selection.frequencyLabel,
                    weekday: session.weekday,
                    start: session.start,
                    end: session.end,
                    label: slotLabel(session.start, session.end),
                    enrolled: 1,
                })
            }

            const loadKey = `${session.weekday}|${session.start}|${session.end}`
            const cell = dayLoad.get(loadKey)
            if (cell) {
                cell.total += 1
            } else {
                dayLoad.set(loadKey, {
                    weekday: session.weekday,
                    start: session.start,
                    end: session.end,
                    label: slotLabel(session.start, session.end),
                    total: 1,
                })
            }
        }
    }

    const byDayThenHour = (a: { weekday: number; start: string }, b: { weekday: number; start: string }) =>
        a.weekday - b.weekday || a.start.localeCompare(b.start)

    const planTotals = input.planTotals.map((plan) => ({
        ticketTypeId: plan.ticketTypeId,
        name: plan.name,
        capacity: plan.capacity,
        sold: plan.sold,
        available: plan.capacity === 0 ? null : Math.max(plan.capacity - plan.sold, 0),
        planKey: plan.planKey ?? null,
        durationMonths: plan.durationMonths ?? null,
        monthlyClassLimit: plan.monthlyClassLimit ?? null,
        price: plan.price ?? null,
        isActive: plan.isActive ?? true,
        currentMembers: currentMembersByType.get(plan.ticketTypeId) ?? 0,
    }))

    const scheduleRows: OccupancyScheduleRow[] = []
    for (const plan of planTotals) {
        const profile = getMembershipScheduleProfile(input.sucursalCode, plan.planKey)
        const base = {
            ticketTypeId: plan.ticketTypeId,
            ticketTypeName: plan.name,
            planKey: plan.planKey,
            durationMonths: plan.durationMonths,
            capacityInPlan: plan.capacity,
            soldInPlan: plan.sold,
            availableInPlan: plan.available,
            currentMembersInPlan: plan.currentMembers,
            monthlyClassLimit: plan.monthlyClassLimit,
            price: plan.price,
            isActive: plan.isActive,
        }

        if (!profile) {
            scheduleRows.push({
                ...base,
                category: "FREE_ACCESS",
                categoryLabel: "Sin horario fijo",
                frequency: "FREE_ACCESS",
                frequencyLabel: "Acceso libre",
                groupId: "free",
                groupLabel: "Sin horario fijo",
                start: "",
                end: "",
                label: "Sin horario fijo",
                enrolled: freeAccessByType.get(plan.ticketTypeId) ?? plan.currentMembers,
                status: "FREE_ACCESS",
            })
            continue
        }

        for (const category of profile.categories) {
            for (const frequency of category.frequencies) {
                for (const group of frequency.dayGroups) {
                    for (const hour of group.hours) {
                        const key = [
                            plan.ticketTypeId,
                            category.id,
                            frequency.id,
                            group.id,
                            hour.start,
                            hour.end,
                        ].join("|")
                        scheduleRows.push({
                            ...base,
                            category: category.id,
                            categoryLabel: category.label,
                            frequency: frequency.id,
                            frequencyLabel: frequency.label,
                            groupId: group.id,
                            groupLabel: group.label,
                            start: hour.start,
                            end: hour.end,
                            label: slotLabel(hour.start, hour.end),
                            enrolled: selectedGroups.get(key) ?? 0,
                            status: "SCHEDULED",
                        })
                    }
                }
            }
        }

        const missing = missingScheduleByType.get(plan.ticketTypeId) ?? 0
        if (missing > 0) {
            scheduleRows.push({
                ...base,
                category: "MISSING_SCHEDULE",
                categoryLabel: "Sin seleccion registrada",
                frequency: "MISSING_SCHEDULE",
                frequencyLabel: "Pendiente de regularizar",
                groupId: "missing",
                groupLabel: "Sin asignar",
                start: "",
                end: "",
                label: "Sin asignar",
                enrolled: missing,
                status: "MISSING_SCHEDULE",
            })
        }
    }

    scheduleRows.sort(
        (a, b) =>
            a.ticketTypeName.localeCompare(b.ticketTypeName, "es") ||
            a.categoryLabel.localeCompare(b.categoryLabel, "es") ||
            a.frequencyLabel.localeCompare(b.frequencyLabel, "es") ||
            a.groupLabel.localeCompare(b.groupLabel, "es") ||
            a.start.localeCompare(b.start)
    )

    return {
        slots: [...slots.values()].sort(
            (a, b) => byDayThenHour(a, b) || a.ticketTypeName.localeCompare(b.ticketTypeName)
        ),
        dayLoad: [...dayLoad.values()].sort(byDayThenHour),
        planTotals,
        scheduleRows,
        currentMembers: [...currentMembersByType.values()].reduce((sum, count) => sum + count, 0),
        missingSchedule: [...missingScheduleByType.values()].reduce((sum, count) => sum + count, 0),
    }
}
