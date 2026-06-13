import test from "node:test"
import assert from "node:assert/strict"
import {
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
