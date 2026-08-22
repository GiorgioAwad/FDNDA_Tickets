import test from "node:test"
import assert from "node:assert/strict"
import {
    getFixedAcademiaScheduleDates,
    getCurrentOrFutureScheduleDates,
    getLimaDateKey,
} from "@/lib/ticket-schedule"

test("getLimaDateKey uses the civil date in Lima", () => {
    assert.equal(
        getLimaDateKey(new Date("2026-06-13T03:30:00.000Z")),
        "2026-06-12"
    )
})

test("getCurrentOrFutureScheduleDates removes past dates", () => {
    assert.deepEqual(
        getCurrentOrFutureScheduleDates(
            ["2026-06-11", "2026-06-13", "2026-06-12", "2026-06-13"],
            "2026-06-12"
        ),
        ["2026-06-12", "2026-06-13"]
    )
})

test("getFixedAcademiaScheduleDates locks a complete academia calendar", () => {
    const dates = ["2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03"]
    assert.deepEqual(
        getFixedAcademiaScheduleDates({
            eventCategory: "ACADEMIA",
            isPackage: true,
            packageDaysCount: 4,
            validDays: dates,
        }),
        dates,
    )
})

test("getFixedAcademiaScheduleDates keeps real date choices editable", () => {
    assert.deepEqual(
        getFixedAcademiaScheduleDates({
            eventCategory: "ACADEMIA",
            isPackage: true,
            packageDaysCount: 4,
            validDays: ["2026-09-12", "2026-09-19", "2026-09-26", "2026-10-03", "2026-10-10"],
        }),
        [],
    )
})
