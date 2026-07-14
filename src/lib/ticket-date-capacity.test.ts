import test from "node:test"
import assert from "node:assert/strict"

import {
    buildTicketDateReservationCounts,
    usesTicketDateCapacity,
} from "./ticket-date-capacity"

const eventStartDate = new Date("2026-08-01T00:00:00Z")
const eventEndDate = new Date("2026-08-05T00:00:00Z")
const validDays = ["2026-08-01", "2026-08-02", "2026-08-03"]

test("EVENTO solo usa cupos diarios cuando capacityByDate está activo", () => {
    assert.equal(usesTicketDateCapacity({ eventCategory: "EVENTO", capacityByDate: true }), true)
    assert.equal(usesTicketDateCapacity({ eventCategory: "EVENTO", capacityByDate: false }), false)
    assert.equal(usesTicketDateCapacity({ eventCategory: "PISCINA_LIBRE", capacityByDate: false }), true)
    assert.equal(usesTicketDateCapacity({ eventCategory: "ACADEMIA", capacityByDate: true }), false)
})

test("dos turnos del mismo día comparten un solo contador diario", () => {
    const counts = buildTicketDateReservationCounts({
        attendees: [
            { scheduleSelections: [{ date: "2026-08-01", shift: "Mañana" }] },
            { scheduleSelections: [{ date: "2026-08-01", shift: "Tarde" }] },
        ],
        quantity: 2,
        validDays,
        eventStartDate,
        eventEndDate,
        ticketLabel: "Individual",
    })

    assert.deepEqual(Array.from(counts.entries()), [["2026-08-01", 2]])
})

test("full day consume cada fecha elegida por cada entrada", () => {
    const counts = buildTicketDateReservationCounts({
        attendees: [
            {
                scheduleSelections: [
                    { date: "2026-08-01" },
                    { date: "2026-08-02" },
                ],
            },
            {
                scheduleSelections: [
                    { date: "2026-08-02" },
                    { date: "2026-08-03" },
                ],
            },
        ],
        quantity: 2,
        validDays,
        eventStartDate,
        eventEndDate,
        ticketLabel: "Full day 2 días",
        requiredSelections: 2,
    })

    assert.deepEqual(Array.from(counts.entries()), [
        ["2026-08-01", 1],
        ["2026-08-02", 2],
        ["2026-08-03", 1],
    ])
})

test("strict false omite entradas sin selección al liberar", () => {
    const counts = buildTicketDateReservationCounts({
        attendees: [{}],
        quantity: 1,
        validDays,
        eventStartDate,
        eventEndDate,
        ticketLabel: "Entrada",
        strict: false,
    })

    assert.equal(counts.size, 0)
})
