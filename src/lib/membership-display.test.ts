import test from "node:test"
import assert from "node:assert/strict"
import { buildMembershipDisplay, type ScanTicket } from "@/lib/scan-helpers"

type Overrides = {
    name?: string
    monthlyClassLimit?: number | null
    allowMultipleDailyScans?: boolean
    membershipScheduleKey?: string | null
    membershipSchedule?: unknown | null
}

const makeTicket = (overrides: Overrides = {}): ScanTicket => ({
    id: "t1",
    orderId: "o1",
    ticketTypeId: "tt1",
    ticketCode: "C1",
    attendeeName: null,
    attendeeDni: null,
    status: "ACTIVE",
    eventId: "e1",
    membershipStartDate: null,
    membershipSchedule: overrides.membershipSchedule ?? null,
    monthlySchedules: null,
    membershipFreeze: null,
    event: {
        title: "Membresías",
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        membershipStartFixed: null,
    },
    ticketType: {
        name: overrides.name ?? "Membresía",
        isPackage: false,
        packageDaysCount: null,
        monthlyClassLimit: overrides.monthlyClassLimit ?? null,
        membershipDurationMonths: null,
        allowMultipleDailyScans: overrides.allowMultipleDailyScans ?? false,
        membershipScheduleKey: overrides.membershipScheduleKey ?? null,
        validDays: null,
    },
    entitlements: [],
})

// Selección de horario BRONCE interdiario (L-M-V, 9-10am) tal como se guarda en
// Ticket.membershipSchedule.
const bronceLmvSchedule = {
    profileKey: "BRONCE",
    sucursalCode: "01",
    category: "ADULTOS",
    categoryLabel: "Adultos",
    frequency: "LMV",
    frequencyLabel: "Lunes, Miércoles y Viernes",
    sessions: [
        { weekday: 1, start: "09:00", end: "10:00" },
        { weekday: 3, start: "09:00", end: "10:00" },
        { weekday: 5, start: "09:00", end: "10:00" },
    ],
    groups: [
        {
            id: "main",
            label: "Lunes, Miércoles y Viernes",
            weekdays: [1, 3, 5],
            start: "09:00",
            end: "10:00",
        },
    ],
}

const TODAY = "2026-03-10"

test("buildMembershipDisplay returns null for non-membership tickets", () => {
    const display = buildMembershipDisplay(makeTicket({ name: "Piscina Libre" }), TODAY)
    assert.equal(display, null)
})

test("buildMembershipDisplay shows plan, frequency and schedule for BRONCE", () => {
    const display = buildMembershipDisplay(
        makeTicket({
            name: "Membresía BRONCE",
            monthlyClassLimit: 12,
            membershipScheduleKey: "BRONCE",
            membershipSchedule: bronceLmvSchedule,
        }),
        TODAY
    )
    assert.ok(display)
    assert.equal(display!.isMembership, true)
    assert.equal(display!.multiDaily, false)
    assert.equal(display!.planLabel, "BRONCE")
    assert.equal(display!.categoryLabel, "Adultos")
    assert.equal(display!.frequencyLabel, "Lunes, Miércoles y Viernes")
    assert.equal(display!.daysLabel, "Lun, Mié, Vie")
    assert.equal(display!.freeAccess, false)
    assert.ok(display!.scheduleText && display!.scheduleText.includes("9:00"))
})

test("buildMembershipDisplay maps BRONCE_2X to 'BRONCE 2×'", () => {
    const display = buildMembershipDisplay(
        makeTicket({
            name: "Membresía BRONCE 2x",
            monthlyClassLimit: 8,
            membershipScheduleKey: "BRONCE_2X",
        }),
        TODAY
    )
    assert.ok(display)
    assert.equal(display!.planLabel, "BRONCE 2×")
})

test("buildMembershipDisplay marks ORO as free access with no schedule", () => {
    const display = buildMembershipDisplay(
        makeTicket({
            name: "Membresía ORO",
            monthlyClassLimit: 60,
            allowMultipleDailyScans: true,
        }),
        TODAY
    )
    assert.ok(display)
    assert.equal(display!.multiDaily, true)
    assert.equal(display!.planLabel, "ORO")
    assert.equal(display!.freeAccess, true)
    assert.equal(display!.frequencyLabel, null)
    assert.equal(display!.scheduleText, null)
})

test("buildMembershipDisplay keeps plan label for BRONCE with doble asistencia", () => {
    // BRONCE con allowMultipleDailyScans (doble asistencia habilitada): la
    // etiqueta sigue siendo BRONCE (no se re-etiqueta como ORO) y conserva su
    // horario, pero multiDaily habilita el 2º ingreso en el panel.
    const display = buildMembershipDisplay(
        makeTicket({
            name: "Membresía BRONCE",
            monthlyClassLimit: 12,
            allowMultipleDailyScans: true,
            membershipScheduleKey: "BRONCE",
            membershipSchedule: bronceLmvSchedule,
        }),
        TODAY
    )
    assert.ok(display)
    assert.equal(display!.multiDaily, true)
    assert.equal(display!.planLabel, "BRONCE")
    assert.equal(display!.freeAccess, false)
    assert.equal(display!.daysLabel, "Lun, Mié, Vie")
})

test("buildMembershipDisplay falls back to 'Membresía' without schedule key", () => {
    const display = buildMembershipDisplay(
        makeTicket({ name: "Membresía Legacy", monthlyClassLimit: 20 }),
        TODAY
    )
    assert.ok(display)
    assert.equal(display!.planLabel, "Membresía")
})
