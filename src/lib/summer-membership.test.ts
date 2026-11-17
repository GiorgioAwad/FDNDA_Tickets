import test from "node:test"
import assert from "node:assert/strict"
import { getMembershipBlackoutMonths, SUMMER_MEMBERSHIP_SCHEDULE_KEY } from "@/lib/membership-config"
import { getMembershipScheduleProfile, validateMembershipScheduleSelection, matchMembershipSession } from "@/lib/membership-schedule"
import { assertMembershipSlotCapacity } from "@/lib/membership-slot-capacity"
import { getMembershipAccessStatus, validateMembershipFreezeMonth, type ScanTicket } from "@/lib/scan-helpers"

const profile = getMembershipScheduleProfile("01", SUMMER_MEMBERSHIP_SCHEDULE_KEY)!
function schedule(category: string, hour: string) {
    const result = validateMembershipScheduleSelection(profile, { category, frequency: "LMV", hours: { main: hour } }, "01")
    if (!result.ok) throw new Error(result.error)
    return result.selection
}

test("summer has exactly 15 hourly slots, 100 places and the supplied age categories", () => {
    const slots = profile.categories.flatMap(c => c.frequencies.flatMap(f => f.dayGroups.flatMap(g => g.hours)))
    assert.equal(slots.length, 15)
    assert.equal(slots.reduce((sum, h) => sum + h.capacity!, 0), 100)
    assert.deepEqual(slots.sort((a,b) => a.start.localeCompare(b.start)).map(h => h.capacity), [6,6,6,6,7,7,6,8,8,8,7,7,6,6,6])
    assert.equal(profile.categories[0].frequencies[0].dayGroups[0].hours.length, 4)
    assert.equal(profile.categories[1].frequencies[0].dayGroups[0].hours.length, 11)
    assert.equal(validateMembershipScheduleSelection(profile, { category: "ADULTOS", frequency: "LMV", hours: { main: "18:00-19:00" } }, "01").ok, false)
    assert.equal(validateMembershipScheduleSelection(profile, { category: "NINOS", frequency: "MJ", hours: { main: "08:00-09:00" } }, "01").ok, false)
    const chosen = schedule("ADULTOS", "06:00-07:00")
    assert.equal(matchMembershipSession(chosen.sessions, 1, "06:30").ok, true)
    assert.equal(matchMembershipSession(chosen.sessions, 2, "06:30").ok, false)
    assert.equal(matchMembershipSession(chosen.sessions, 1, "08:30").ok, false)
})

test("summer rejects a seventh reservation in a six-place slot; other hours remain independent", () => {
    const six = Array.from({ length: 6 }, () => schedule("ADULTOS", "06:00-07:00"))
    assert.doesNotThrow(() => assertMembershipSlotCapacity(profile, six))
    assert.throws(() => assertMembershipSlotCapacity(profile, [...six, six[0]]), /agotado/)
    assert.doesNotThrow(() => assertMembershipSlotCapacity(profile, [...six, schedule("ADULTOS", "07:00-08:00")]))
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
