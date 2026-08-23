import test from "node:test"
import assert from "node:assert/strict"
import { buildMembershipOccupancy, type OccupancyTicketSnapshot } from "@/lib/membership-occupancy"

const BASE_LMV_4PM = {
    profileKey: "BRONCE",
    sucursalCode: "03",
    category: "NINOS" as const,
    categoryLabel: "Ninos",
    frequency: "LMV" as const,
    frequencyLabel: "Lun - Mie - Vie",
    sessions: [1, 3, 5].map((weekday) => ({ weekday: weekday as 1 | 3 | 5, start: "16:00", end: "17:00" })),
    groups: [{ id: "main", label: "Lun, Mie y Vie", weekdays: [1, 3, 5] as const, start: "16:00", end: "17:00" }],
}

const BASE_LMV_3PM = {
    ...BASE_LMV_4PM,
    sessions: [1, 3, 5].map((weekday) => ({ weekday: weekday as 1 | 3 | 5, start: "15:00", end: "16:00" })),
    groups: [{ id: "main", label: "Lun, Mie y Vie", weekdays: [1, 3, 5] as const, start: "15:00", end: "16:00" }],
}

// Sesiones en orden inverso para probar que el sort realmente funciona
const BASE_LMV_REVERSE = {
    profileKey: "BRONCE",
    sucursalCode: "03",
    category: "ADULTOS" as const,
    categoryLabel: "Adultos",
    frequency: "LMV" as const,
    frequencyLabel: "Lun - Mie - Vie",
    sessions: [5, 3, 1].map((weekday) => ({ weekday: weekday as 1 | 3 | 5, start: "16:00", end: "17:00" })),
    groups: [{ id: "main", label: "Lun, Mie y Vie", weekdays: [1, 3, 5] as const, start: "16:00", end: "17:00" }],
}

function ticket(overrides: Partial<OccupancyTicketSnapshot> = {}): OccupancyTicketSnapshot {
    return {
        id: "tk-1",
        ticketTypeId: "tt-bronce",
        ticketTypeName: "MEMBRESIA SEMESTRAL BRONCE",
        planKey: "BRONCE",
        baseSchedule: BASE_LMV_4PM,
        monthlySchedules: [],
        monthIndex: 0,
        counts: true,
        ...overrides,
    }
}

test("cuenta una sesion por dia de la franja elegida", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket()],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    const row = occupancy.slots.find((s) => s.weekday === 1 && s.start === "16:00")
    assert.ok(row)
    assert.equal(row.enrolled, 1)
    assert.equal(occupancy.slots.filter((s) => s.enrolled > 0).length, 3)
})

test("usa el horario efectivo del mes, no el del checkout", () => {
    const moved = ticket({
        monthlySchedules: [{ monthIndex: 2, selection: BASE_LMV_3PM }],
        monthIndex: 3,
    })
    const occupancy = buildMembershipOccupancy({
        tickets: [moved],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    assert.equal(occupancy.slots.find((s) => s.weekday === 1 && s.start === "15:00")?.enrolled, 1)
    assert.equal(occupancy.slots.find((s) => s.weekday === 1 && s.start === "16:00")?.enrolled, undefined)
})

test("un cambio mensual posterior al mes en curso todavia no aplica", () => {
    const future = ticket({
        monthlySchedules: [{ monthIndex: 5, selection: BASE_LMV_3PM }],
        monthIndex: 3,
    })
    const occupancy = buildMembershipOccupancy({
        tickets: [future],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    assert.equal(occupancy.slots.find((s) => s.weekday === 1 && s.start === "16:00")?.enrolled, 1)
})

test("un carnet marcado como no contable se excluye", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket({ counts: false })],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 }],
    })
    assert.equal(occupancy.slots.length, 0)
    assert.equal(occupancy.dayLoad.length, 0)
})

test("la carga por dia y hora suma todos los planes", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [
            ticket({ id: "a" }),
            ticket({ id: "b", planKey: "PLATA", ticketTypeId: "tt-plata", ticketTypeName: "PLATA" }),
        ],
        planTotals: [
            { ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 1 },
            { ticketTypeId: "tt-plata", name: "PLATA", capacity: 100, sold: 1 },
        ],
    })
    const cell = occupancy.dayLoad.find((c) => c.weekday === 1 && c.start === "16:00")
    assert.equal(cell?.total, 2)
    // Pero en la matriz por franja siguen separados por plan.
    assert.equal(occupancy.slots.filter((s) => s.weekday === 1 && s.start === "16:00").length, 2)
})

test("los totales por plan salen del capacity y sold del tipo", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 80, sold: 55 }],
    })
    assert.equal(occupancy.planTotals[0].available, 25)
    assert.equal(occupancy.planTotals[0].capacity, 80)
    assert.equal(occupancy.planTotals[0].sold, 55)
})

test("el reporte incluye el catalogo completo y conserva las franjas en cero", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket()],
        planTotals: [{
            ticketTypeId: "tt-bronce",
            name: "MEMBRESIA SEMESTRAL BRONCE",
            capacity: 100,
            sold: 1,
            planKey: "BRONCE",
            durationMonths: 6,
        }],
        sucursalCode: "03",
    })

    const occupied = occupancy.scheduleRows.find(
        (row) => row.category === "NINOS" && row.frequency === "LMV" && row.start === "16:00"
    )
    assert.equal(occupied?.enrolled, 1)
    assert.ok(occupancy.scheduleRows.some((row) => row.status === "SCHEDULED" && row.enrolled === 0))
    assert.equal(occupied?.availableInPlan, 99)
})

test("reporta por separado los carnets vigentes sin horario", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket({ baseSchedule: null })],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 10, sold: 1, planKey: "BRONCE" }],
        sucursalCode: "03",
    })
    assert.equal(occupancy.missingSchedule, 1)
    assert.equal(occupancy.scheduleRows.find((row) => row.status === "MISSING_SCHEDULE")?.enrolled, 1)
})

test("capacity 0 se reporta como sin tope", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [],
        planTotals: [{ ticketTypeId: "tt-x", name: "X", capacity: 0, sold: 12 }],
    })
    assert.equal(occupancy.planTotals[0].available, null)
})

test("un carnet sin horario semanal cuenta solo en su plan (caso VMT)", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [ticket({ baseSchedule: null, planKey: null })],
        planTotals: [{ ticketTypeId: "tt-bronce", name: "LUN - MIE - VIE 4PM", capacity: 30, sold: 1 }],
    })
    assert.equal(occupancy.slots.length, 0)
    assert.equal(occupancy.dayLoad.length, 0)
    assert.equal(occupancy.planTotals[0].sold, 1)
})

test("las franjas salen ordenadas por dia y hora", () => {
    const occupancy = buildMembershipOccupancy({
        tickets: [
            // Primer ticket con sesiones en orden inverso (5, 3, 1) se insertaría en ese orden
            ticket({
                id: "tk-reverse",
                baseSchedule: BASE_LMV_REVERSE,
                ticketTypeName: "MEMBRESIA ADULTOS",
            }),
            // Segundo ticket con sesiones en orden ascendente (1, 3, 5)
            ticket({ id: "tk-normal" }),
        ],
        planTotals: [
            { ticketTypeId: "tt-bronce", name: "BRONCE", capacity: 100, sold: 2 },
        ],
    })
    const keys = occupancy.slots.map((s) => `${s.weekday}:${s.start}`)
    // Sin el .sort(), resultaría en orden de inserción del Map: 5,3,1 del primer ticket, luego 1,3,5 del segundo
    // Con el .sort(), sale en orden ascendente: 1,3,5,1,3,5 (agrupado por categoría después de día/hora)
    const sorted = [...keys].sort()
    assert.deepEqual(keys, sorted, `slots deben estar ordenadas por dia y hora. Got: ${keys.join(", ")}, expected: ${sorted.join(", ")}`)
})
