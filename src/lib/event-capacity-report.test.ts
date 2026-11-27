import test from "node:test"
import assert from "node:assert/strict"

import { buildEventCapacityReportRows, type EventCapacityTicketType } from "@/lib/event-capacity-report"
import type { MembershipOccupancy } from "@/lib/membership-occupancy"

const EMPTY_MEMBERSHIP: MembershipOccupancy = {
    slots: [],
    dayLoad: [],
    planTotals: [],
    scheduleRows: [],
    currentMembers: 0,
    missingSchedule: 0,
}

function ticketType(overrides: Partial<EventCapacityTicketType> = {}): EventCapacityTicketType {
    return {
        id: "type-1",
        name: "Entrada general",
        capacity: 100,
        sold: 25,
        capacityByDate: false,
        isPackage: false,
        packageDaysCount: null,
        validDays: null,
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        isActive: true,
        dateInventories: [],
        ...overrides,
    }
}

const BASE_EVENT = {
    category: "EVENTO",
    startDate: new Date("2026-09-12T00:00:00Z"),
    endDate: new Date("2026-09-13T00:00:00Z"),
    eventDays: [],
}

test("reporta el cupo global de un evento general por tipo de entrada", () => {
    const rows = buildEventCapacityReportRows({
        event: BASE_EVENT,
        ticketTypes: [ticketType()],
        membershipOccupancy: EMPTY_MEMBERSHIP,
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0].occupied, 25)
    assert.equal(rows[0].available, 75)
    assert.equal(rows[0].scopeLabel, "Tipo de entrada")
})

test("academia sin perfil semanal usa cada tipo de entrada como horario", () => {
    const rows = buildEventCapacityReportRows({
        event: { ...BASE_EVENT, category: "ACADEMIA" },
        ticketTypes: [ticketType({
            name: "LUN - MIE - VIE - 6AM A 7AM",
            monthlyClassLimit: 12,
            membershipDurationMonths: 6,
            validDays: ["2026-09-14", "2026-09-16", "2026-09-18"],
        })],
        membershipOccupancy: {
            ...EMPTY_MEMBERSHIP,
            currentMembers: 20,
            planTotals: [{
                ticketTypeId: "type-1",
                name: "LUN - MIE - VIE - 6AM A 7AM",
                capacity: 100,
                sold: 25,
                available: 75,
                planKey: null,
                durationMonths: 6,
                monthlyClassLimit: 12,
                price: 230,
                isActive: true,
                currentMembers: 20,
            }],
        },
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0].occupied, 20)
    assert.equal(rows[0].frequencyLabel, "Lun - Mie - Vie")
    assert.equal(rows[0].scopeLabel, "Plan completo")
})

test("piscina libre usa inventario real por fecha y la capacidad base si aun no hay fila", () => {
    const rows = buildEventCapacityReportRows({
        event: { ...BASE_EVENT, category: "PISCINA_LIBRE" },
        ticketTypes: [ticketType({
            capacity: 30,
            sold: 8,
            validDays: ["2026-09-12", "2026-09-13"],
            dateInventories: [{
                date: "2026-09-12",
                capacity: 20,
                sold: 7,
                isEnabled: true,
            }],
        })],
        membershipOccupancy: EMPTY_MEMBERSHIP,
    })

    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((row) => row.occupied), [7, 0])
    assert.deepEqual(rows.map((row) => row.available), [13, 30])
    assert.ok(rows.every((row) => row.scopeLabel === "Fecha"))
})

test("una fecha cerrada conserva su cupo configurado pero reporta cero disponibles", () => {
    const rows = buildEventCapacityReportRows({
        event: { ...BASE_EVENT, category: "PISCINA_LIBRE" },
        ticketTypes: [ticketType({
            validDays: ["2026-09-12"],
            dateInventories: [{
                date: "2026-09-12",
                capacity: 20,
                sold: 7,
                isEnabled: false,
            }],
        })],
        membershipOccupancy: EMPTY_MEMBERSHIP,
    })

    assert.equal(rows[0].capacity, 20)
    assert.equal(rows[0].available, 0)
    assert.equal(rows[0].status, "CLOSED")
})

test("una bolsa de piscina conserva cupo global y no se multiplica por fecha", () => {
    const rows = buildEventCapacityReportRows({
        event: { ...BASE_EVENT, category: "PISCINA_LIBRE" },
        ticketTypes: [ticketType({
            name: "Bolsa de 10 visitas",
            isPackage: true,
            packageDaysCount: 10,
            validDays: ["2026-09-12", "2026-09-13"],
        })],
        membershipOccupancy: EMPTY_MEMBERSHIP,
    })

    assert.equal(rows.length, 1)
    assert.equal(rows[0].scopeLabel, "Tipo de entrada")
    assert.equal(rows[0].occupied, 25)
})

test("evento con cupo diario no presenta como disponible una fecha sin configurar", () => {
    const rows = buildEventCapacityReportRows({
        event: BASE_EVENT,
        ticketTypes: [ticketType({
            capacityByDate: true,
            validDays: ["2026-09-12"],
        })],
        membershipOccupancy: EMPTY_MEMBERSHIP,
    })

    assert.equal(rows[0].available, 0)
    assert.equal(rows[0].status, "CLOSED")
    assert.equal(rows[0].scopeLabel, "Fecha")
})

test("planes con cupo por franja (verano) se reportan por franja: ocupados = pagados + pendientes, cupo y libres de la franja", () => {
    const rows = buildEventCapacityReportRows({
        event: { ...BASE_EVENT, category: "ACADEMIA" },
        ticketTypes: [ticketType({ id: "verano", name: "VERANO 2027 · 3 VECES POR SEMANA", capacity: 78, sold: 19, monthlyClassLimit: 12, membershipDurationMonths: 2 })],
        membershipOccupancy: EMPTY_MEMBERSHIP,
        slotInventories: [{
            ticketTypeId: "verano",
            slots: [
                { key: "ADULTOS:LMV:main:06:00:07:00", categoryLabel: "Adultos (18 años a más)", frequencyLabel: "Lunes, Miércoles y Viernes", groupLabel: "Lunes, Miércoles y Viernes", start: "06:00", end: "07:00", capacity: 3, paid: 3, pending: 0, available: 0 },
                { key: "ADULTOS:LMV:main:07:00:08:00", categoryLabel: "Adultos (18 años a más)", frequencyLabel: "Lunes, Miércoles y Viernes", groupLabel: "Lunes, Miércoles y Viernes", start: "07:00", end: "08:00", capacity: 3, paid: 1, pending: 1, available: 1 },
            ],
        }],
    })
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map(r => [r.scheduleLabel, r.occupied, r.capacity, r.available, r.scopeLabel, r.soldTotal]), [
        ["6:00 a.m. - 7:00 a.m.", 3, 3, 0, "Franja", 19],
        ["7:00 a.m. - 8:00 a.m.", 2, 3, 1, "Franja", 19],
    ])
})
