import test from "node:test"
import assert from "node:assert/strict"
import {
    getMembershipPeriod,
    buildMembershipMonthlySummary,
    type ScanTicket,
} from "@/lib/scan-helpers"

const makeTicket = (
    startDate: string,
    monthlyClassLimit: number,
    usedDates: string[]
): ScanTicket => ({
    id: "t1",
    orderId: "o1",
    ticketTypeId: "tt1",
    ticketCode: "C1",
    attendeeName: null,
    attendeeDni: null,
    status: "ACTIVE",
    eventId: "e1",
    event: {
        title: "Membresías",
        startDate: new Date(`${startDate}T00:00:00Z`),
        endDate: new Date("2026-12-31T00:00:00Z"),
    },
    ticketType: {
        name: "PLATA",
        isPackage: false,
        packageDaysCount: null,
        monthlyClassLimit,
        validDays: null,
    },
    entitlements: usedDates.map((d, i) => ({
        id: `en${i}`,
        date: new Date(`${d}T12:00:00Z`),
        status: "USED" as const,
        usedAt: new Date(),
    })),
})

test("getMembershipPeriod anchors months to the event start day", () => {
    const period = getMembershipPeriod("2026-04-10", new Date("2026-03-15T00:00:00Z"))
    assert.ok(period)
    assert.equal(period!.index, 0) // 2026-04-10 sigue dentro del primer ciclo [03-15, 04-15)
    assert.equal(period!.startStr, "2026-03-15")
    assert.equal(period!.endStr, "2026-04-15")
})

test("getMembershipPeriod advances to the next cycle past the anchor day", () => {
    const period = getMembershipPeriod("2026-04-20", new Date("2026-03-15T00:00:00Z"))
    assert.ok(period)
    assert.equal(period!.index, 1)
    assert.equal(period!.startStr, "2026-04-15")
    assert.equal(period!.endStr, "2026-05-15")
})

test("getMembershipPeriod returns null before the membership starts", () => {
    const period = getMembershipPeriod("2026-02-28", new Date("2026-03-15T00:00:00Z"))
    assert.equal(period, null)
})

test("monthly summary counts only classes used in the current cycle", () => {
    const ticket = makeTicket("2026-03-01", 20, [
        "2026-03-05",
        "2026-03-10",
        "2026-03-20",
        "2026-04-02",
    ])
    assert.deepEqual(buildMembershipMonthlySummary(ticket, "2026-03-15"), {
        total: 20,
        used: 3,
        remaining: 17,
    })
    // Al cambiar de mes el conteo se reinicia (use-it-or-lose-it)
    assert.deepEqual(buildMembershipMonthlySummary(ticket, "2026-04-10"), {
        total: 20,
        used: 1,
        remaining: 19,
    })
})

test("monthly summary blocks when the cycle quota is exhausted", () => {
    const usedDates = Array.from(
        { length: 20 },
        (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`
    )
    const ticket = makeTicket("2026-03-01", 20, usedDates)
    assert.equal(buildMembershipMonthlySummary(ticket, "2026-03-25").remaining, 0)
})
