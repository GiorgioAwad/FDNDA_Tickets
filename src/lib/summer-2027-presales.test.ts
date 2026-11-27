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
// 50 L-M-V + M-J-S limitado por el sábado (adultos 6+7am, niños 8am-2pm).
const MAX_3X: Record<string, number> = { "01": 50 + 6 + 22, "03": 50 + 8 + 22, "04": 50 + 8 + 22 }
// CDM: 6-7pm es de adultos (2026-11-27); VIDENA/VMT: desde las 7pm.
const ADULT_STARTS = (sede: string) => Object.keys(EXCEL[sede]).filter(h => h < "08:00" || h >= (sede === "01" ? "18:00" : "19:00"))

for (const sede of ["01", "03", "04"]) {
    test(`preventas verano 2027 sede ${sede}: cupos del Excel, 50 alumnos por frecuencia, adultos 6-8am y desde 7pm`, () => {
        const p3 = getMembershipScheduleProfile(sede, SUMMER_2027_3X_SCHEDULE_KEY)!
        const p2 = getMembershipScheduleProfile(sede, SUMMER_2027_2X_SCHEDULE_KEY)!
        assert.equal(p3.planMode, "CHOOSE_FREQUENCY")
        assert.equal(p2.planMode, "FIXED_FREQUENCY")
        assert.deepEqual(p3.categories.map(c => [c.id, c.frequencies.map(f => f.id)]), [["ADULTOS", ["LMV", "MJS"]], ["NINOS", ["LMV", "MJS"]]])
        assert.deepEqual(p2.categories.map(c => [c.id, c.frequencies.map(f => f.id)]), [["ADULTOS", ["MJ"]], ["NINOS", ["MJ"]]])

        for (const [profile, frequency] of [[p3, "LMV"], [p3, "MJS"], [p2, "MJ"]] as const) {
            // M-J-S: el grupo Mar/Jue sigue el Excel; el sábado se prueba aparte.
            const slots = listMembershipLimitedSlots(profile).filter(s => s.frequency === frequency && s.groupId !== "saturday")
            assert.deepEqual(Object.fromEntries(slots.map(s => [s.start, s.capacity])), EXCEL[sede], `${sede} ${frequency}`)
            assert.equal(slots.reduce((sum, s) => sum + s.capacity, 0), 50)
            assert.deepEqual(slots.filter(s => s.category === "ADULTOS").map(s => s.start), ADULT_STARTS(sede))
        }
        // Sábado: adultos 6-8am, niños 8am-2pm; cupo = el de esa hora (11 y 12 en VIDENA/VMT: los de CDM).
        const saturday = listMembershipLimitedSlots(p3).filter(s => s.groupId === "saturday")
        const satCap = (h: string) => EXCEL[sede][h] ?? EXCEL["01"][h]
        assert.deepEqual(saturday.filter(s => s.category === "ADULTOS").map(s => `${s.start}:${s.capacity}`), ["06:00", "07:00"].map(h => `${h}:${satCap(h)}`))
        assert.deepEqual(saturday.filter(s => s.category === "NINOS").map(s => `${s.start}:${s.capacity}`), ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"].map(h => `${h}:${satCap(h)}`))
        // Alumnos M-J-S = el grupo más chico (el sábado) por categoría.
        assert.equal(maxMembershipStudents(listMembershipLimitedSlots(p3)), MAX_3X[sede])
        assert.equal(maxMembershipStudents(listMembershipLimitedSlots(p2)), 50)
    })
}

test("verano 2027: M-J-S una hora para Mar/Jue y otra para el sábado; Mar-Jue solo martes y jueves; categoría estricta", () => {
    const p3 = getMembershipScheduleProfile("03", SUMMER_2027_3X_SCHEDULE_KEY)!
    const p2 = getMembershipScheduleProfile("03", SUMMER_2027_2X_SCHEDULE_KEY)!
    const mjs = validateMembershipScheduleSelection(p3, { category: "NINOS", frequency: "MJS", hours: { weekday: "15:00-16:00", saturday: "11:00-12:00" } }, "03")
    assert.ok(mjs.ok)
    assert.deepEqual(mjs.selection.sessions.map(s => s.weekday), [2, 4, 6])
    assert.equal(matchMembershipSession(mjs.selection.sessions, 4, "15:10").ok, true)
    assert.equal(matchMembershipSession(mjs.selection.sessions, 6, "11:10").ok, true)
    assert.equal(matchMembershipSession(mjs.selection.sessions, 6, "15:10").ok, false)
    const adult = validateMembershipScheduleSelection(p3, { category: "ADULTOS", frequency: "MJS", hours: { weekday: "20:00-21:00", saturday: "07:00-08:00" } }, "03")
    assert.ok(adult.ok)
    assert.equal(matchMembershipSession(adult.selection.sessions, 2, "20:05").ok, true)
    assert.equal(matchMembershipSession(adult.selection.sessions, 6, "07:05").ok, true)
    assert.equal(validateMembershipScheduleSelection(p3, { category: "ADULTOS", frequency: "MJS", hours: { weekday: "06:00-07:00", saturday: "19:00-20:00" } }, "03").ok, false)
    assert.equal(validateMembershipScheduleSelection(p3, { category: "NINOS", frequency: "MJS", hours: { weekday: "15:00-16:00", saturday: "14:00-15:00" } }, "03").ok, false)
    assert.equal(validateMembershipScheduleSelection(p3, { category: "NINOS", frequency: "MJS", hours: { weekday: "15:00-16:00" } }, "03").ok, false)
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
        const hours: Record<string, string> = frequency === "LMV" ? { main: "06:00-07:00" } : { weekday: "06:00-07:00", saturday: "06:00-07:00" }
        const r = validateMembershipScheduleSelection(p3, { category: "ADULTOS", frequency, hours }, "01")
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

test("verano 2027 → ABIO: el código sale de la hora de Mar/Jue (el sábado no lo cambia); Mar-Jue usa su propio mapa", async () => {
    const { resolveAcademiaAbioSchedule } = await import("@/lib/abio-membership-schedule")
    const p3 = getMembershipScheduleProfile("01", SUMMER_2027_3X_SCHEDULE_KEY)!
    const p2 = getMembershipScheduleProfile("01", SUMMER_2027_2X_SCHEDULE_KEY)!
    const config = (profileKey: string, codes: Record<string, string>) => ({ membershipSchedules: { profileKey, serviceStartDate: "2027-01-01", codes } })
    const kid = validateMembershipScheduleSelection(p3, { category: "NINOS", frequency: "MJS", hours: { weekday: "15:00-16:00", saturday: "09:00-10:00" } }, "01")
    assert.ok(kid.ok)
    assert.deepEqual(
        resolveAcademiaAbioSchedule({ extraConfig: config(SUMMER_2027_3X_SCHEDULE_KEY, { "NINOS:MJS:15:00-16:00": "000040" }), scheduleCode: null, selection: kid.selection, sucursalCode: "01" }),
        { scheduleCode: "000040", serviceDate: "2027-01-01" }
    )
    const adult = validateMembershipScheduleSelection(p2, { category: "ADULTOS", frequency: "MJ", hours: { main: "20:00-21:00" } }, "01")
    assert.ok(adult.ok)
    assert.equal(resolveAcademiaAbioSchedule({ extraConfig: config(SUMMER_2027_2X_SCHEDULE_KEY, { "ADULTOS:MJ:20:00-21:00": "000149" }), scheduleCode: null, selection: adult.selection, sucursalCode: "01" }).scheduleCode, "000149")
    assert.throws(() => resolveAcademiaAbioSchedule({ extraConfig: config(SUMMER_2027_2X_SCHEDULE_KEY, {}), scheduleCode: null, selection: adult.selection, sucursalCode: "01" }), /no tiene un código ABIO/)
})

test("Campo de Marte: 6-7pm es de adultos en L-M-V, Mar/Jue de M-J-S y Mar-Jue; los niños llegan hasta las 6pm", () => {
    const p3 = getMembershipScheduleProfile("01", SUMMER_2027_3X_SCHEDULE_KEY)!
    const p2 = getMembershipScheduleProfile("01", SUMMER_2027_2X_SCHEDULE_KEY)!
    const ok = (profile: typeof p3, category: string, frequency: string, hours: Record<string, string>) =>
        validateMembershipScheduleSelection(profile, { category, frequency, hours }, "01").ok
    assert.equal(ok(p3, "ADULTOS", "LMV", { main: "18:00-19:00" }), true)
    assert.equal(ok(p3, "NINOS", "LMV", { main: "18:00-19:00" }), false)
    assert.equal(ok(p3, "ADULTOS", "MJS", { weekday: "18:00-19:00", saturday: "07:00-08:00" }), true)
    assert.equal(ok(p3, "NINOS", "MJS", { weekday: "18:00-19:00", saturday: "09:00-10:00" }), false)
    assert.equal(ok(p2, "ADULTOS", "MJ", { main: "18:00-19:00" }), true)
    assert.equal(ok(p2, "NINOS", "MJ", { main: "17:00-18:00" }), true)
    // Plan sin cambio de capacidad: 50 L-M-V + M-J-S limitado por el sábado.
    assert.equal(maxMembershipStudents(listMembershipLimitedSlots(p3)), 78)
    // VIDENA y VMT no cambian: 6-7pm sigue siendo de niños.
    assert.equal(ok(getMembershipScheduleProfile("03", SUMMER_2027_3X_SCHEDULE_KEY)!, "NINOS", "LMV", { main: "18:00-19:00" }), true)
    assert.equal(ok(getMembershipScheduleProfile("04", SUMMER_2027_3X_SCHEDULE_KEY)!, "NINOS", "LMV", { main: "18:00-19:00" }), true)
})
