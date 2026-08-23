import type { MembershipOccupancy } from "@/lib/membership-occupancy"
import { getTicketSelectableDates, usesTicketDateCapacity } from "@/lib/ticket-date-capacity"
import { getShiftOptionsForDate, parseTicketScheduleConfig } from "@/lib/ticket-schedule"

export type EventCapacityRowStatus = "ACTIVE" | "INACTIVE" | "CLOSED" | "MISSING_SCHEDULE"

export interface EventCapacityReportRow {
    id: string
    ticketTypeId: string
    ticketTypeName: string
    categoryLabel: string
    frequencyLabel: string
    dateLabel: string
    scheduleLabel: string
    occupied: number
    capacity: number
    available: number | null
    soldTotal: number
    scopeLabel: "Plan completo" | "Fecha" | "Tipo de entrada"
    status: EventCapacityRowStatus
}

export interface EventCapacityTicketType {
    id: string
    name: string
    capacity: number
    sold: number
    capacityByDate: boolean
    isPackage: boolean
    packageDaysCount: number | null
    validDays: unknown
    monthlyClassLimit: number | null
    membershipDurationMonths: number | null
    isActive: boolean
    dateInventories: Array<{
        date: Date | string
        capacity: number
        sold: number
        isEnabled: boolean
    }>
}

interface EventCapacityInput {
    event: {
        category: string
        startDate: Date
        endDate: Date
        eventDays: Array<{ date: Date | string; openTime: string; closeTime: string }>
    }
    ticketTypes: EventCapacityTicketType[]
    membershipOccupancy: MembershipOccupancy
}

const CATEGORY_LABELS: Record<string, string> = {
    ACADEMIA: "Academia",
    PISCINA_LIBRE: "Piscina libre",
    EVENTO: "Evento",
}

const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"]

function isPoolBag(type: EventCapacityTicketType, eventCategory: string): boolean {
    return (
        eventCategory === "PISCINA_LIBRE" &&
        type.isPackage &&
        typeof type.packageDaysCount === "number" &&
        type.packageDaysCount > 0
    )
}

function dateKey(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat("es-PE", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`))
}

function available(capacity: number, occupied: number, enabled = true): number | null {
    if (!enabled) return 0
    return capacity === 0 ? null : Math.max(capacity - occupied, 0)
}

function frequencyForDates(dates: string[]): string {
    if (dates.length === 0) return "Sin frecuencia"
    const weekdays = Array.from(
        new Set(dates.map((date) => new Date(`${date}T00:00:00Z`).getUTCDay()))
    ).sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
    return weekdays.map((weekday) => WEEKDAY_LABELS[weekday]).join(" - ")
}

function summarizeDates(dates: string[], startDate: Date, endDate: Date): string {
    if (dates.length === 1) return formatDate(dates[0])
    if (dates.length > 1 && dates.length <= 3) return dates.map(formatDate).join(" / ")
    if (dates.length > 3) {
        return `${formatDate(dates[0])} a ${formatDate(dates[dates.length - 1])} (${dates.length} fechas)`
    }
    const start = dateKey(startDate)
    const end = dateKey(endDate)
    return start === end ? formatDate(start) : `${formatDate(start)} a ${formatDate(end)}`
}

function globalScheduleLabel(input: EventCapacityInput, shifts: string[]): string {
    if (shifts.length > 0) return shifts.join(" / ")
    if (input.event.category === "ACADEMIA") return "Definido en el tipo de entrada"
    const times = Array.from(
        new Set(input.event.eventDays.map((day) => `${day.openTime} - ${day.closeTime}`))
    )
    return times.length > 0 ? times.join(" / ") : "Sin horario configurado"
}

export function buildEventCapacityReportRows(input: EventCapacityInput): EventCapacityReportRow[] {
    const rows: EventCapacityReportRow[] = []
    const planByType = new Map(input.membershipOccupancy.planTotals.map((plan) => [plan.ticketTypeId, plan]))

    for (const type of input.ticketTypes) {
        const isMembership = Boolean(type.monthlyClassLimit && type.membershipDurationMonths)
        const membershipRows = input.membershipOccupancy.scheduleRows.filter(
            (row) => row.ticketTypeId === type.id && row.status !== "FREE_ACCESS"
        )

        if (isMembership && membershipRows.some((row) => row.status === "SCHEDULED")) {
            for (const row of membershipRows) {
                rows.push({
                    id: `membership:${type.id}:${row.category}:${row.frequency}:${row.groupId}:${row.start}:${row.status}`,
                    ticketTypeId: type.id,
                    ticketTypeName: type.name,
                    categoryLabel: row.categoryLabel,
                    frequencyLabel: row.frequencyLabel,
                    dateLabel: row.groupLabel,
                    scheduleLabel: row.label,
                    occupied: row.enrolled,
                    capacity: row.capacityInPlan,
                    available: row.availableInPlan,
                    soldTotal: row.soldInPlan,
                    scopeLabel: "Plan completo",
                    status: row.status === "MISSING_SCHEDULE" ? "MISSING_SCHEDULE" : type.isActive ? "ACTIVE" : "INACTIVE",
                })
            }
            continue
        }

        const schedule = parseTicketScheduleConfig(type.validDays)
        const categoryLabel = CATEGORY_LABELS[input.event.category] ?? input.event.category
        const plan = planByType.get(type.id)

        if (isMembership) {
            const occupied = plan?.currentMembers ?? 0
            rows.push({
                id: `membership-plan:${type.id}`,
                ticketTypeId: type.id,
                ticketTypeName: type.name,
                categoryLabel,
                frequencyLabel: frequencyForDates(schedule.dates),
                dateLabel: summarizeDates(schedule.dates, input.event.startDate, input.event.endDate),
                scheduleLabel: globalScheduleLabel(input, schedule.shifts),
                occupied,
                capacity: type.capacity,
                available: available(type.capacity, type.sold),
                soldTotal: type.sold,
                scopeLabel: "Plan completo",
                status: type.isActive ? "ACTIVE" : "INACTIVE",
            })
            continue
        }

        const usesDateCapacity =
            usesTicketDateCapacity({
                eventCategory: input.event.category,
                capacityByDate: type.capacityByDate,
            }) &&
            !isPoolBag(type, input.event.category)

        if (usesDateCapacity) {
            const inventories = new Map(type.dateInventories.map((row) => [dateKey(row.date), row]))
            const dates = getTicketSelectableDates({
                validDays: type.validDays,
                eventStartDate: input.event.startDate,
                eventEndDate: input.event.endDate,
            })
            const eventDayTimes = new Map(
                input.event.eventDays.map((day) => [dateKey(day.date), `${day.openTime} - ${day.closeTime}`])
            )

            for (const date of dates) {
                const inventory = inventories.get(date)
                const capacity = inventory?.capacity ?? type.capacity
                const occupied = inventory?.sold ?? 0
                const requiresConfiguredInventory =
                    input.event.category === "EVENTO" && type.capacityByDate
                const enabled = inventory?.isEnabled ?? !requiresConfiguredInventory
                const shifts = getShiftOptionsForDate(schedule, date)
                rows.push({
                    id: `date:${type.id}:${date}`,
                    ticketTypeId: type.id,
                    ticketTypeName: type.name,
                    categoryLabel,
                    frequencyLabel: "Por fecha",
                    dateLabel: formatDate(date),
                    scheduleLabel: shifts.length > 0 ? shifts.join(" / ") : eventDayTimes.get(date) ?? "Todo el dia",
                    occupied,
                    capacity,
                    available: available(capacity, occupied, enabled),
                    soldTotal: type.sold,
                    scopeLabel: "Fecha",
                    status: !type.isActive ? "INACTIVE" : enabled ? "ACTIVE" : "CLOSED",
                })
            }
            continue
        }

        rows.push({
            id: `type:${type.id}`,
            ticketTypeId: type.id,
            ticketTypeName: type.name,
            categoryLabel,
            frequencyLabel: frequencyForDates(schedule.dates),
            dateLabel: summarizeDates(schedule.dates, input.event.startDate, input.event.endDate),
            scheduleLabel: globalScheduleLabel(input, schedule.shifts),
            occupied: type.sold,
            capacity: type.capacity,
            available: available(type.capacity, type.sold),
            soldTotal: type.sold,
            scopeLabel: "Tipo de entrada",
            status: type.isActive ? "ACTIVE" : "INACTIVE",
        })
    }

    return rows.sort((a, b) =>
        a.ticketTypeName.localeCompare(b.ticketTypeName, "es") || a.id.localeCompare(b.id)
    )
}
