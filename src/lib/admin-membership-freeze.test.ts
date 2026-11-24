import assert from "node:assert/strict"
import test from "node:test"
import { planAdminMembershipFreeze } from "./admin-membership-freeze"
import { getMembershipAccessStatus, getMembershipFreezeRanges, type ScanTicket } from "./scan-helpers"

function ticket(): ScanTicket {
    return {
        id: "ticket", orderId: "order", ticketTypeId: "type", ticketCode: "code",
        attendeeName: null, attendeeDni: null, status: "ACTIVE", eventId: "event",
        membershipStartDate: new Date("2026-08-03T12:00:00Z"),
        event: { title: "Membresía", startDate: new Date("2026-03-01T12:00:00Z"), endDate: new Date("2026-12-31T12:00:00Z") },
        ticketType: { name: "BRONCE", monthlyClassLimit: 12, membershipDurationMonths: 6,
            isPackage: true, packageDaysCount: 12, validDays: null },
        entitlements: [],
    }
}

test("administración puede congelar diciembre y meses separados, sin cambiar el inicio", () => {
    const t = ticket()
    const plan = planAdminMembershipFreeze(t, ["2027-03", "2026-12", "2026-12"])
    assert.deepEqual(plan.added, ["2026-12", "2027-03"])
    assert.equal(plan.membershipExpiry, "2027-06-03")
    assert.equal(t.membershipStartDate?.toISOString().slice(0, 10), "2026-08-03")
})

test("meses adicionales bloquean el QR solamente durante esos meses y conservan el original", () => {
    const t = ticket()
    t.membershipFreeze = { month: "2026-10", startDate: "2026-10-01", endDate: "2026-11-01", additionalMonths: ["2026-12", "2027-03", "2026-12"] }
    for (const day of ["2026-10-15", "2026-12-01", "2026-12-31", "2027-03-15"]) {
        assert.equal(getMembershipAccessStatus(t, day).status, "FROZEN", day)
    }
    assert.equal(getMembershipAccessStatus(t, "2026-11-15").status, "OK")
    assert.equal(getMembershipAccessStatus(t, "2027-04-01").status, "OK")
    assert.equal(getMembershipAccessStatus(t, "2027-04-01").expiryStr, "2027-07-03")
    assert.equal(getMembershipFreezeRanges(t).length, 3)
    assert.deepEqual(planAdminMembershipFreeze(t, ["2026-12"]).added, [])
})

test("puede agregarse otro mes a una membresía que ya usó su congelamiento", () => {
    const t = ticket()
    t.membershipFreeze = { month: "2026-10", startDate: "2026-10-01", endDate: "2026-11-01" }
    const plan = planAdminMembershipFreeze(t, ["2026-12"])
    assert.deepEqual(plan.added, ["2026-12"])
    assert.equal(plan.membershipExpiry, "2027-06-03")
})

test("un rango legado de varios meses conserva la compensación que ya tenía", () => {
    const t = ticket()
    t.membershipFreeze = { month: "octubre y noviembre 2026", startDate: "2026-10-01", endDate: "2026-12-01" }
    const plan = planAdminMembershipFreeze(t, ["2026-11", "2026-12"])
    assert.deepEqual(plan.added, ["2026-12"])
    assert.equal(plan.membershipExpiry, "2027-06-03")
})

test("el cierre de sede y los meses individuales no extienden dos veces el mismo mes", () => {
    const t = ticket()
    t.event.membershipFreezeStart = new Date("2026-11-01T12:00:00Z")
    t.event.membershipFreezeEnd = new Date("2027-01-01T12:00:00Z")
    t.event.membershipFreezeExtensionMonths = 2
    t.membershipFreeze = { month: "2026-10", startDate: "2026-10-01", endDate: "2026-11-01", additionalMonths: ["2026-12"] }
    assert.deepEqual(planAdminMembershipFreeze(t, ["2026-12"]).added, [])
    assert.equal(getMembershipAccessStatus(t, "2026-12-15").expiryStr, "2027-07-03")
})

test("el forzado admite un mes parcial y retroactivo dentro de la vigencia", () => {
    assert.deepEqual(planAdminMembershipFreeze(ticket(), ["2026-08"]).added, ["2026-08"])
})

test("rechaza meses imposibles, vacíos, fuera de vigencia y meses ya extendidos automáticamente", () => {
    for (const months of [null, [], ["2026-13"], ["2026-00"], ["diciembre"], [123], ["2026-01"], ["2027-02"], ["2026-07"], ["2030-12"], Array(25).fill("2026-12")]) {
        assert.throws(() => planAdminMembershipFreeze(ticket(), months), { name: "Error" }, JSON.stringify(months))
    }
})

test("rechaza entradas canceladas, planes sin vigencia y planes de verano", () => {
    const cancelled = ticket(); cancelled.status = "CANCELLED"
    const noTerm = ticket(); noTerm.ticketType.membershipDurationMonths = null
    const summer = ticket(); summer.ticketType.membershipScheduleKey = "VERANO_3X"
    for (const t of [cancelled, noTerm, summer]) assert.throws(() => planAdminMembershipFreeze(t, ["2026-12"]))
})
