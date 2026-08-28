import assert from "node:assert/strict"
import test from "node:test"

import { buildEntitlementDates } from "./entitlement-dates"

const event = {
    startDate: new Date(Date.UTC(2026, 8, 1, 12)),
    endDate: new Date(Date.UTC(2026, 8, 3, 12)),
}

const toKeys = (dates: Date[]) => dates.map((d) => d.toISOString().slice(0, 10))

test("una membresia con cupo mensual no pre-genera entitlements", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: false, packageDaysCount: null, monthlyClassLimit: 12, validDays: null },
        event,
        attendee: null,
    })
    assert.deepEqual(dates, [])
})

test("piscina libre genera un solo dia: el elegido", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: false, packageDaysCount: null, monthlyClassLimit: null, validDays: null },
        event,
        attendee: { scheduleSelections: [{ date: "2026-09-02", shift: null }] },
        eventCategory: "PISCINA_LIBRE",
    })
    assert.deepEqual(toKeys(dates), ["2026-09-02"])
})

test("una bolsa de piscina no pre-genera entitlements", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: true, packageDaysCount: 10, monthlyClassLimit: null, validDays: null },
        event,
        attendee: null,
        eventCategory: "PISCINA_LIBRE",
    })
    assert.deepEqual(dates, [])
})

test("un paquete toma exactamente packageDaysCount fechas elegidas", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: true, packageDaysCount: 2, monthlyClassLimit: null, validDays: null },
        event,
        attendee: {
            scheduleSelections: [
                { date: "2026-09-01", shift: null },
                { date: "2026-09-03", shift: null },
                { date: "2026-09-02", shift: null },
            ],
        },
    })
    assert.deepEqual(toKeys(dates), ["2026-09-01", "2026-09-03"])
})

test("una entrada de evento sin seleccion cubre todo el rango del evento", () => {
    const dates = buildEntitlementDates({
        ticketType: { isPackage: false, packageDaysCount: null, monthlyClassLimit: null, validDays: null },
        event,
        attendee: null,
    })
    assert.equal(dates.length, 3)
})
