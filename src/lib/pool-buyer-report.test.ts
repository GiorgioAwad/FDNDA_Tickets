import assert from "node:assert/strict"
import test from "node:test"
import {
    consolidatePoolBuyers,
    isoWeekday,
    matchesPoolReportSlot,
    type PoolBuyerVisit,
} from "./pool-buyer-report"

test("matchesPoolReportSlot compares the two times in a schedule label", () => {
    assert.equal(matchesPoolReportSlot("18:00 - 19:00", "18:00", "19:00"), true)
    assert.equal(matchesPoolReportSlot("Turno 18:00 a 19:00", "18:00", "19:00"), true)
    assert.equal(matchesPoolReportSlot("19:00 - 20:00", "18:00", "19:00"), false)
})

test("isoWeekday uses ISO weekdays without timezone drift", () => {
    assert.equal(isoWeekday("2026-09-24"), 4)
    assert.equal(isoWeekday("2026-09-25"), 5)
})

test("consolidatePoolBuyers groups visits from the same buyer", () => {
    const base: PoolBuyerVisit = {
        eventId: "event-1",
        eventName: "Piscina libre",
        date: "2026-09-24",
        schedule: "18:00 - 19:00",
        source: "Entrada directa",
        reservationId: "ticket-1",
        orderId: "order-1",
        paidAt: "2026-09-20T10:00:00.000Z",
        buyerName: "Ana Pérez",
        buyerDocument: "12345678",
        buyerEmail: "ana@example.com",
        buyerPhone: "999999999",
        attendeeName: "Ana Pérez",
        attendeeDocument: "12345678",
    }

    const result = consolidatePoolBuyers([
        base,
        { ...base, date: "2026-09-25", reservationId: "ticket-2", orderId: "order-2" },
    ])

    assert.equal(result.length, 1)
    assert.equal(result[0].visitCount, 2)
    assert.deepEqual(result[0].orderIds, ["order-1", "order-2"])
})
