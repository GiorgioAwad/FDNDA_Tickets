import test from "node:test"
import assert from "node:assert/strict"
import {
    frequencyKeyFromDates,
    getDuplicateScheduleFrequencies,
    getFirstFrequencyDate,
    listDateKeysBetween,
    remapDatesByFrequency,
} from "@/lib/event-duplication-schedule"

test("detecta y agrupa las frecuencias configuradas en los tipos de entrada", () => {
    const frequencies = getDuplicateScheduleFrequencies([
        { validDays: ["2026-08-04", "2026-08-06", "2026-08-11", "2026-08-13"] },
        { validDays: ["2026-08-04", "2026-08-06"] },
        { validDays: ["2026-08-03", "2026-08-05", "2026-08-07"] },
        { validDays: [] },
    ])

    assert.deepEqual(frequencies, [
        { key: "1,3,5", label: "Lunes, Miércoles y Viernes", weekdays: [1, 3, 5], ticketTypeCount: 1 },
        { key: "2,4", label: "Martes y Jueves", weekdays: [2, 4], ticketTypeCount: 2 },
    ])
})

test("sugiere el primer día real de la frecuencia dentro del nuevo rango", () => {
    assert.equal(getFirstFrequencyDate([2, 4], "2026-08-31", "2026-09-30"), "2026-09-01")
    assert.equal(getFirstFrequencyDate([6], "2026-09-01", "2026-09-30"), "2026-09-05")
})

test("remapea una frecuencia solo desde la fecha de inicio configurada", () => {
    const targetDates = listDateKeysBetween("2026-09-01", "2026-09-30")
    const remapped = remapDatesByFrequency(
        ["2026-08-04", "2026-08-06"],
        targetDates,
        "2026-09-10",
    )

    assert.deepEqual(remapped, [
        "2026-09-10",
        "2026-09-15",
        "2026-09-17",
        "2026-09-22",
        "2026-09-24",
        "2026-09-29",
    ])
    assert.equal(frequencyKeyFromDates(remapped), "2,4")
})
