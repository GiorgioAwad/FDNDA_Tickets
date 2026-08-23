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
}

export interface MembershipOccupancy {
    slots: OccupancySlotRow[]
    dayLoad: OccupancyDayLoadCell[]
    planTotals: OccupancyPlanRow[]
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
}): MembershipOccupancy {
    const slots = new Map<string, OccupancySlotRow>()
    const dayLoad = new Map<string, OccupancyDayLoadCell>()

    for (const ticket of input.tickets) {
        if (!ticket.counts) continue
        const selection = effectiveSelection(ticket)
        if (!selection) continue

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

    return {
        slots: [...slots.values()].sort(
            (a, b) => byDayThenHour(a, b) || a.ticketTypeName.localeCompare(b.ticketTypeName)
        ),
        dayLoad: [...dayLoad.values()].sort(byDayThenHour),
        planTotals: input.planTotals.map((plan) => ({
            ...plan,
            available: plan.capacity === 0 ? null : Math.max(plan.capacity - plan.sold, 0),
        })),
    }
}
