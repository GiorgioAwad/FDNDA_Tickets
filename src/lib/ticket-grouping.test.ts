import assert from "node:assert/strict"
import test from "node:test"
import {
    alignSelectionsToTicketDates,
    buildTicketDateGroupKey,
    findTicketScheduleSelections,
    mergeGroupScheduleSelections,
} from "./ticket-grouping"

test("groups ticket categories by date even when their shifts differ", () => {
    const general = [{ date: "2026-08-01", shift: "Mañana" }]
    const child = [{ date: "2026-08-01", shift: "Tarde" }]

    assert.equal(buildTicketDateGroupKey(general), "2026-08-01")
    assert.equal(buildTicketDateGroupKey(child), "2026-08-01")
    assert.deepEqual(mergeGroupScheduleSelections([general, child]), [
        { date: "2026-08-01", shift: "Mañana" },
        { date: "2026-08-01", shift: "Tarde" },
    ])
})

test("keeps different purchased dates in different groups", () => {
    assert.notEqual(
        buildTicketDateGroupKey([{ date: "2026-08-01", shift: "Mañana" }]),
        buildTicketDateGroupKey([{ date: "2026-08-02", shift: "Mañana" }])
    )
})

test("leaves tickets without a purchased date outside date groups", () => {
    assert.equal(buildTicketDateGroupKey([]), null)
})

test("uses attendee position for anonymous tickets with different dates", () => {
    const attendees = [
        { name: "", dni: "", scheduleSelections: [{ date: "2026-08-01", shift: "Mañana" }] },
        { name: "", dni: "", scheduleSelections: [{ date: "2026-08-02", shift: "Tarde" }] },
    ]

    assert.deepEqual(findTicketScheduleSelections({
        attendees,
        attendeeName: "Comprador",
        attendeeDni: null,
        attendeeIndex: 1,
    }), [{ date: "2026-08-02", shift: "Tarde" }])
})

test("ticket entitlements preserve the issued date while retaining its shift", () => {
    assert.deepEqual(
        alignSelectionsToTicketDates(
            [{ date: "2026-08-02", shift: "Tarde" }],
            ["2026-08-02"]
        ),
        [{ date: "2026-08-02", shift: "Tarde" }]
    )
})
