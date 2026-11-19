import test from "node:test"
import assert from "node:assert/strict"
import { getMembershipBlackoutMonths, SUMMER_MEMBERSHIP_SCHEDULE_KEY } from "@/lib/membership-config"
import { getMembershipScheduleProfile, validateMembershipScheduleSelection, matchMembershipSession } from "@/lib/membership-schedule"
import { applySlotCapacityOverrides, assertMembershipSlotCapacity, countMembershipSlotReservations, listMembershipLimitedSlots, maxMembershipStudents, membershipSlotKey, parseSlotCapacityOverrides, summarizeMembershipSlotsByStudent } from "@/lib/membership-slot-capacity"
import { getMembershipAccessStatus, validateMembershipFreezeMonth, type ScanTicket } from "@/lib/scan-helpers"

const profile = getMembershipScheduleProfile("01", SUMMER_MEMBERSHIP_SCHEDULE_KEY)!
function schedule(category: string, hour: string) {
    const result = validateMembershipScheduleSelection(profile, { category, frequency: "LMV", hours: { main: hour } }, "01")
    if (!result.ok) throw new Error(result.error)
    return result.selection
}

test("summer L-M-V keeps its 15 hourly slots, 106 places and the supplied age categories", () => {
    const lmvSlots = profile.categories.flatMap(c => c.frequencies.filter(f => f.id === "LMV").flatMap(f => f.dayGroups.flatMap(g => g.hours)))
    assert.equal(lmvSlots.length, 15)
    assert.equal(lmvSlots.reduce((sum, h) => sum + h.capacity!, 0), 106)
    assert.deepEqual(lmvSlots.sort((a,b) => a.start.localeCompare(b.start)).map(h => h.capacity), [12,6,6,6,7,7,6,8,8,8,7,7,6,6,6])
    assert.equal(profile.planMode, "CHOOSE_FREQUENCY")
    assert.deepEqual(profile.categories.map(c => c.frequencies.map(f => f.id)), [["LMV", "MJS"], ["LMV", "MJS"]])
    assert.equal(profile.categories[0].frequencies[0].dayGroups[0].hours.length, 4)
    assert.equal(profile.categories[1].frequencies[0].dayGroups[0].hours.length, 11)
    assert.equal(validateMembershipScheduleSelection(profile, { category: "ADULTOS", frequency: "LMV", hours: { main: "18:00-19:00" } }, "01").ok, false)
    assert.equal(validateMembershipScheduleSelection(profile, { category: "NINOS", frequency: "MJ", hours: { main: "08:00-09:00" } }, "01").ok, false)
    assert.equal(validateMembershipScheduleSelection(profile, { category: "ADULTOS", hours: { main: "06:00-07:00" } }, "01").ok, false)
    const chosen = schedule("ADULTOS", "06:00-07:00")
    assert.equal(matchMembershipSession(chosen.sessions, 1, "06:30").ok, true)
    assert.equal(matchMembershipSession(chosen.sessions, 2, "06:30").ok, false)
    assert.equal(matchMembershipSession(chosen.sessions, 1, "08:30").ok, false)
})

function mjs(category: "ADULTOS" | "NINOS", hours: Record<string, string>) {
    const result = validateMembershipScheduleSelection(profile, { category, frequency: "MJS", hours }, "01")
    if (!result.ok) throw new Error(result.error)
    return result.selection
}

test("summer M-J-S: adults one hour 6-8am for Tue/Thu/Sat; kids Tue/Thu like L-M-V plus their own Saturday hour 8am-2pm", () => {
    const [adults, kids] = profile.categories.map(c => c.frequencies.find(f => f.id === "MJS")!)
    assert.deepEqual(adults.dayGroups.map(g => [g.weekdays, g.hours.map(h => `${h.start}-${h.end}:${h.capacity}`)]), [[[2, 4, 6], ["06:00-07:00:12", "07:00-08:00:6"]]])
    assert.deepEqual(kids.dayGroups.map(g => g.weekdays), [[2, 4], [6]])
    assert.deepEqual(kids.dayGroups[0].hours, profile.categories[1].frequencies[0].dayGroups[0].hours)
    assert.deepEqual(kids.dayGroups[1].hours.map(h => `${h.start}:${h.capacity}`), ["08:00:6", "09:00:6", "10:00:7", "11:00:7", "12:00:6", "13:00:8"])

    const adult = mjs("ADULTOS", { main: "07:00-08:00" })
    assert.deepEqual(adult.sessions.map(s => s.weekday), [2, 4, 6])
    assert.equal(matchMembershipSession(adult.sessions, 6, "07:10").ok, true)
    assert.equal(matchMembershipSession(adult.sessions, 1, "07:10").ok, false)
    assert.throws(() => mjs("ADULTOS", { main: "19:00-20:00" }), /no está disponible/)
    assert.throws(() => mjs("ADULTOS", { main: "08:00-09:00" }), /no está disponible/)

    const kid = mjs("NINOS", { weekday: "17:00-18:00", saturday: "09:00-10:00" })
    assert.equal(matchMembershipSession(kid.sessions, 4, "17:30").ok, true)
    assert.equal(matchMembershipSession(kid.sessions, 6, "09:30").ok, true)
    assert.equal(matchMembershipSession(kid.sessions, 6, "17:30").ok, false)
    assert.doesNotThrow(() => mjs("NINOS", { weekday: "17:00-18:00", saturday: "13:00-14:00" }))
    assert.throws(() => mjs("NINOS", { weekday: "17:00-18:00", saturday: "14:00-15:00" }), /no está disponible/)
    assert.throws(() => mjs("NINOS", { weekday: "17:00-18:00" }), /Selecciona el horario/)
})

test("summer M-J-S has its own places per hour: a full L-M-V slot does not block M-J-S and vice versa", () => {
    const lmvFull = Array.from({ length: 12 }, () => schedule("ADULTOS", "06:00-07:00"))
    const mjsFull = Array.from({ length: 12 }, () => mjs("ADULTOS", { main: "06:00-07:00" }))
    assert.doesNotThrow(() => assertMembershipSlotCapacity(profile, [...lmvFull, ...mjsFull]))
    assert.throws(() => assertMembershipSlotCapacity(profile, [...lmvFull, ...mjsFull, mjsFull[0]]), /agotado/)
    // Sábado 8am: 6 cupos, aunque cada niño tenga distinta hora de Mar/Jue.
    const saturday = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"].map(h => mjs("NINOS", { weekday: `${h}-${String(Number(h.slice(0, 2)) + 1).padStart(2, "0")}:00`, saturday: "08:00-09:00" }))
    assert.doesNotThrow(() => assertMembershipSlotCapacity(profile, saturday))
    assert.throws(() => assertMembershipSlotCapacity(profile, [...saturday, mjs("NINOS", { weekday: "14:00-15:00", saturday: "08:00-09:00" })]), /8:00|08:00/)
})

test("plan capacity counts students: kids M-J-S are capped by the smaller of Tue/Thu (76) and Saturday (40)", () => {
    const slots = listMembershipLimitedSlots(profile)
    assert.equal(slots.length, 15 + 2 + 11 + 6)
    assert.equal(maxMembershipStudents(slots), 106 + 18 + 40)
    const rows = slots.map(s => ({ ...s, paid: 0, pending: 0 }))
    const kidKeys = [membershipSlotKey("NINOS", "MJS", "weekday", "15:00", "16:00"), membershipSlotKey("NINOS", "MJS", "saturday", "10:00", "11:00")]
    for (const row of rows) if (kidKeys.includes(row.key)) row.paid = 1
    assert.deepEqual(summarizeMembershipSlotsByStudent(rows), { capacity: 164, paid: 1, pending: 0, available: 163 })
})

test("summer rejects a 13th reservation in the twelve-place 6am slot; other hours remain independent", () => {
    const twelve = Array.from({ length: 12 }, () => schedule("ADULTOS", "06:00-07:00"))
    assert.doesNotThrow(() => assertMembershipSlotCapacity(profile, twelve))
    assert.throws(() => assertMembershipSlotCapacity(profile, [...twelve, twelve[0]]), /agotado/)
    assert.doesNotThrow(() => assertMembershipSlotCapacity(profile, [...twelve, schedule("ADULTOS", "07:00-08:00")]))
    const eight = Array.from({ length: 8 }, () => schedule("NINOS", "13:00-14:00"))
    assert.doesNotThrow(() => assertMembershipSlotCapacity(profile, eight))
    assert.throws(() => assertMembershipSlotCapacity(profile, [...eight, eight[0]]), /agotado/)
})

test("summer ends on March 1, permits January and February, and does not alter standard memberships", () => {
    const ticket = {
        status: "ACTIVE", membershipStartDate: new Date("2027-01-01T12:00:00Z"),
        event: { startDate: new Date("2026-11-17"), endDate: new Date("2026-11-20") },
        ticketType: { monthlyClassLimit: 13, membershipDurationMonths: 2, membershipScheduleKey: SUMMER_MEMBERSHIP_SCHEDULE_KEY },
    } as ScanTicket
    assert.equal(getMembershipAccessStatus(ticket, "2026-12-31").status, "NOT_STARTED")
    assert.equal(getMembershipAccessStatus(ticket, "2027-01-01").status, "OK")
    assert.equal(getMembershipAccessStatus(ticket, "2027-02-28").status, "OK")
    assert.equal(getMembershipAccessStatus(ticket, "2027-03-01").status, "EXPIRED")
    assert.equal(getMembershipAccessStatus(ticket, "2027-02-01").expiryStr, "2027-03-01")
    assert.equal(validateMembershipFreezeMonth(ticket, "2027-02", new Date("2026-11-17")).ok, false)
    assert.deepEqual(getMembershipBlackoutMonths("BRONCE"), [1, 2])
    assert.equal(getMembershipAccessStatus({ ...ticket, ticketType: { ...ticket.ticketType, membershipScheduleKey: "BRONCE" } }, "2027-01-01").status, "BLACKOUT")
})

test("admin overrides change a slot's capacity without mutating the shared catalog", () => {
    const sixAm = membershipSlotKey("ADULTOS", "LMV", "main", "06:00", "07:00")
    const sevenAm = membershipSlotKey("ADULTOS", "LMV", "main", "07:00", "08:00")
    const edited = applySlotCapacityOverrides(profile, { [sixAm]: 14, [sevenAm]: 2 })
    const fourteen = Array.from({ length: 14 }, () => schedule("ADULTOS", "06:00-07:00"))
    assert.doesNotThrow(() => assertMembershipSlotCapacity(edited, fourteen))
    assert.throws(() => assertMembershipSlotCapacity(edited, [...fourteen, fourteen[0]]), /agotado/)
    assert.throws(() => assertMembershipSlotCapacity(edited, Array.from({ length: 3 }, () => schedule("ADULTOS", "07:00-08:00"))), /agotado/)
    // El catálogo compartido queda intacto.
    assert.throws(() => assertMembershipSlotCapacity(profile, fourteen), /agotado/)
    const slots = listMembershipLimitedSlots(profile, { [sixAm]: 14 })
    assert.equal(slots.length, 34)
    assert.deepEqual(slots.find(s => s.key === sixAm), {
        key: sixAm, category: "ADULTOS", categoryLabel: "Adultos (18 años a más)", frequency: "LMV",
        frequencyLabel: profile.categories[0].frequencies[0].label, groupId: "main", groupLabel: "Lunes, Miércoles y Viernes",
        start: "06:00", end: "07:00", defaultCapacity: 12, capacity: 14,
    })
})

test("override parsing ignores junk and counting reports unreadable schedules instead of hiding them", () => {
    assert.deepEqual(parseSlotCapacityOverrides({ a: 3, b: -1, c: 1.5, d: "4", e: 1000 }), { a: 3 })
    assert.deepEqual(parseSlotCapacityOverrides(null), {})
    assert.deepEqual(parseSlotCapacityOverrides([1]), {})
    const { occupancy, invalid } = countMembershipSlotReservations(profile, [schedule("NINOS", "13:00-14:00"), null, { foo: 1 }])
    assert.equal(invalid, 2)
    assert.equal(occupancy.get(membershipSlotKey("NINOS", "LMV", "main", "13:00", "14:00")), 1)
})
