import test from "node:test"
import assert from "node:assert/strict"
import { getMembershipBlackoutMonths, isSummerMembership, SUMMER_2027_2X_SCHEDULE_KEY, SUMMER_2027_3X_SCHEDULE_KEY } from "@/lib/membership-config"
import { getMembershipScheduleProfile, matchMembershipSession, validateMembershipScheduleSelection } from "@/lib/membership-schedule"
import { assertMembershipSlotCapacity, listMembershipLimitedSlots, maxMembershipStudents } from "@/lib/membership-slot-capacity"

// "CUPOS x Horario 2027 LIMA.xlsx": cupos por hora de inicio, iguales en L-M-V, M-J-S y Mar-Jue.
const EXCEL: Record<string, Record<string, number>> = {
    "01": { "06:00": 3, "07:00": 3, "08:00": 4, "09:00": 4, "10:00": 4, "11:00": 4, "12:00": 3, "13:00": 3, "14:00": 3, "15:00": 3, "16:00": 3, "17:00": 3, "18:00": 4, "19:00": 3, "20:00": 3 },
    "03": { "06:00": 4, "07:00": 4, "08:00": 4, "09:00": 4, "10:00": 4, "13:00": 3, "14:00": 3, "15:00": 3, "16:00": 3, "17:00": 3, "18:00": 3, "19:00": 4, "20:00": 4, "21:00": 4 },
    "04": { "06:00": 4, "07:00": 4, "08:00": 4, "09:00": 4, "10:00": 4, "13:00": 3, "14:00": 3, "15:00": 4, "16:00": 4, "17:00": 4, "18:00": 4, "19:00": 4, "20:00": 4 },
}
const ADULT_STARTS = (sede: string) => Object.keys(EXCEL[sede]).filter(h => h < "08:00" || h >= "19:00")

for (const sede of ["01", "03", "04"]) {
    test(`preventas verano 2027 sede ${sede}: cupos del Excel, 50 alumnos por frecuencia, adultos 6-8am y desde 7pm`, () => {
        const p3 = getMembershipScheduleProfile(sede, SUMMER_2027_3X_SCHEDULE_KEY)!
        const p2 = getMembershipScheduleProfile(sede, SUMMER_2027_2X_SCHEDULE_KEY)!
        assert.equal(p3.planMode, "CHOOSE_FREQUENCY")
        assert.equal(p2.planMode, "FIXED_FREQUENCY")
        assert.deepEqual(p3.categories.map(c => [c.id, c.frequencies.map(f => f.id)]), [["ADULTOS", ["LMV", "MJS"]], ["NINOS", ["LMV", "MJS"]]])
        assert.deepEqual(p2.categories.map(c => [c.id, c.frequencies.map(f => f.id)]), [["ADULTOS", ["MJ"]], ["NINOS", ["MJ"]]])

        for (const [profile, frequency] of [[p3, "LMV"], [p3, "MJS"], [p2, "MJ"]] as const) {
            const slots = listMembershipLimitedSlots(profile).filter(s => s.frequency === frequency)
            assert.deepEqual(Object.fromEntries(slots.map(s => [s.start, s.capacity])), EXCEL[sede], `${sede} ${frequency}`)
            assert.equal(slots.reduce((sum, s) => sum + s.capacity, 0), 50)
            assert.deepEqual(slots.filter(s => s.category === "ADULTOS").map(s => s.start), ADULT_STARTS(sede))
        }
        assert.equal(maxMembershipStudents(listMembershipLimitedSlots(p3)), 100)
        assert.equal(maxMembershipStudents(listMembershipLimitedSlots(p2)), 50)
    })
}

test("verano 2027: M-J-S una hora para Mar/Jue/Sáb, Mar-Jue solo martes y jueves; categoría estricta", () => {
    const p3 = getMembershipScheduleProfile("03", SUMMER_2027_3X_SCHEDULE_KEY)!
    const p2 = getMembershipScheduleProfile("03", SUMMER_2027_2X_SCHEDULE_KEY)!
    const mjs = validateMembershipScheduleSelection(p3, { category: "NINOS", frequency: "MJS", hours: { main: "15:00-16:00" } }, "03")
    assert.ok(mjs.ok)
    assert.deepEqual(mjs.selection.sessions.map(s => s.weekday), [2, 4, 6])
    assert.equal(matchMembershipSession(mjs.selection.sessions, 6, "15:10").ok, true)
    const mj = validateMembershipScheduleSelection(p2, { category: "ADULTOS", frequency: "MJ", hours: { main: "21:00-22:00" } }, "03")
    assert.ok(mj.ok)
    assert.deepEqual(mj.selection.sessions.map(s => s.weekday), [2, 4])
    assert.equal(validateMembershipScheduleSelection(p3, { category: "ADULTOS", frequency: "LMV", hours: { main: "09:00-10:00" } }, "03").ok, false)
    assert.equal(validateMembershipScheduleSelection(p3, { category: "NINOS", frequency: "LMV", hours: { main: "11:00-12:00" } }, "03").ok, false)
    assert.equal(validateMembershipScheduleSelection(p2, { category: "NINOS", frequency: "MJ", hours: { main: "21:00-22:00" } }, "04").ok, false)
})

test("verano 2027: L-M-V y M-J-S no comparten cupo; la franja se agota en su tope", () => {
    const p3 = getMembershipScheduleProfile("01", SUMMER_2027_3X_SCHEDULE_KEY)!
    const pick = (frequency: string) => {
        const r = validateMembershipScheduleSelection(p3, { category: "ADULTOS", frequency, hours: { main: "06:00-07:00" } }, "01")
        if (!r.ok) throw new Error(r.error)
        return r.selection
    }
    const three = [pick("LMV"), pick("LMV"), pick("LMV"), pick("MJS"), pick("MJS"), pick("MJS")]
    assert.doesNotThrow(() => assertMembershipSlotCapacity(p3, three))
    assert.throws(() => assertMembershipSlotCapacity(p3, [...three, pick("LMV")]), /agotado/)
})

test("verano 2027 es membresía de verano: enero y febrero válidos, sin blackout", () => {
    for (const key of [SUMMER_2027_3X_SCHEDULE_KEY, SUMMER_2027_2X_SCHEDULE_KEY]) {
        assert.equal(isSummerMembership(key), true)
        assert.deepEqual(getMembershipBlackoutMonths(key), [])
    }
    assert.equal(isSummerMembership("BRONCE"), false)
    assert.equal(isSummerMembership(null), false)
})
