import assert from "node:assert/strict"
import test from "node:test"
import {
    getCurrentLimaMonth,
    getLimaDateKey,
    getReportPeriodStart,
    projectMonthlyRevenue,
} from "./reporting-period"

test("report periods use Lima calendar days and include today", () => {
    const now = new Date("2026-09-23T02:00:00.000Z") // September 22 in Lima
    assert.equal(getLimaDateKey(now), "2026-09-22")
    assert.equal(getReportPeriodStart("7d", now)?.toISOString(), "2026-09-16T05:00:00.000Z")
    assert.equal(getReportPeriodStart("30d", now)?.toISOString(), "2026-08-24T05:00:00.000Z")
    assert.equal(getReportPeriodStart("all", now), null)
})

test("monthly projection uses current-month revenue and elapsed Lima days", () => {
    const now = new Date("2026-09-23T02:00:00.000Z")
    const month = getCurrentLimaMonth(now)
    assert.equal(month.start.toISOString(), "2026-09-01T05:00:00.000Z")
    assert.equal(month.end.toISOString(), "2026-10-01T05:00:00.000Z")
    assert.equal(month.elapsedDays, 22)
    assert.equal(month.daysInMonth, 30)
    assert.equal(projectMonthlyRevenue(220, now), 300)
})

test("monthly projection uses the actual length of a leap-year month", () => {
    const now = new Date("2028-02-10T18:00:00.000Z")
    assert.equal(getCurrentLimaMonth(now).daysInMonth, 29)
    assert.equal(projectMonthlyRevenue(100, now), 290)
})
