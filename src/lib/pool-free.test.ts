import test from "node:test"
import assert from "node:assert/strict"
import { buildPoolFreeReservationCounts, getPoolFreeSelectableDates } from "@/lib/pool-free"

test("getPoolFreeSelectableDates falls back to full event range", () => {
    const dates = getPoolFreeSelectableDates({
        validDays: [],
        eventStartDate: new Date("2026-04-01T12:00:00Z"),
        eventEndDate: new Date("2026-04-03T12:00:00Z"),
    })

    assert.deepEqual(dates, ["2026-04-01", "2026-04-02", "2026-04-03"])
})

test("buildPoolFreeReservationCounts groups attendees by selected date", () => {
    const counts = buildPoolFreeReservationCounts({
        attendees: [
            { scheduleSelections: [{ date: "2026-04-10" }] },
            { scheduleSelections: [{ date: "2026-04-10" }] },
            { scheduleSelections: [{ date: "2026-04-11" }] },
        ],
        quantity: 3,
        validDays: [],
        eventStartDate: new Date("2026-04-01T12:00:00Z"),
        eventEndDate: new Date("2026-04-30T12:00:00Z"),
        ticketLabel: "Piscina libre 6:00am",
    })

    assert.equal(counts.get("2026-04-10"), 2)
    assert.equal(counts.get("2026-04-11"), 1)
})

test("buildPoolFreeReservationCounts requires a selected date when strict", () => {
    assert.throws(
        () =>
            buildPoolFreeReservationCounts({
                attendees: [{ scheduleSelections: [] }],
                quantity: 1,
                validDays: [],
                eventStartDate: new Date("2026-04-01T12:00:00Z"),
                eventEndDate: new Date("2026-04-30T12:00:00Z"),
                ticketLabel: "Piscina libre 6:00am",
            }),
        /Debes seleccionar un dia/
    )
})
