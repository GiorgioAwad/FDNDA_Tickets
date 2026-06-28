import test from "node:test"
import assert from "node:assert/strict"
import {
    getMembershipPeriod,
    getMembershipExpiry,
    isFixedTermMembership,
    isWithinMembershipWindow,
    getMembershipAccessStatus,
    validateMembershipFreezeMonth,
    getEligibleMembershipFreezeMonths,
    membershipAllowsMultipleDailyScans,
    buildMembershipMonthlySummary,
    getMembershipAnchor,
    type ScanTicket,
} from "@/lib/scan-helpers"
import { isBlackoutMonth } from "@/lib/membership-config"

type MakeTicketOptions = {
    membershipStartDate?: string | null
    membershipStartFixed?: string | null
    membershipDurationMonths?: number | null
    allowMultipleDailyScans?: boolean
    membershipFreeze?: {
        month: string
        startDate: string
        endDate: string
    } | null
}

const makeTicket = (
    startDate: string,
    monthlyClassLimit: number,
    usedDates: string[],
    options: MakeTicketOptions = {}
): ScanTicket => ({
    id: "t1",
    orderId: "o1",
    ticketTypeId: "tt1",
    ticketCode: "C1",
    attendeeName: null,
    attendeeDni: null,
    status: "ACTIVE",
    eventId: "e1",
    membershipStartDate: options.membershipStartDate
        ? new Date(`${options.membershipStartDate}T12:00:00Z`)
        : null,
    membershipFreeze: options.membershipFreeze
        ? {
              month: options.membershipFreeze.month,
              startDate: new Date(`${options.membershipFreeze.startDate}T12:00:00Z`),
              endDate: new Date(`${options.membershipFreeze.endDate}T12:00:00Z`),
          }
        : null,
    event: {
        title: "Membresías",
        startDate: new Date(`${startDate}T00:00:00Z`),
        endDate: new Date("2026-12-31T00:00:00Z"),
        membershipStartFixed: options.membershipStartFixed
            ? new Date(`${options.membershipStartFixed}T12:00:00Z`)
            : null,
    },
    ticketType: {
        name: "PLATA",
        isPackage: false,
        packageDaysCount: null,
        monthlyClassLimit,
        membershipDurationMonths: options.membershipDurationMonths ?? null,
        allowMultipleDailyScans: options.allowMultipleDailyScans ?? false,
        validDays: null,
    },
    entitlements: usedDates.map((d, i) => ({
        id: `en${i}`,
        date: new Date(`${d}T12:00:00Z`),
        status: "USED" as const,
        usedAt: new Date(),
    })),
})

test("getMembershipPeriod anchors months to the anchor day", () => {
    const period = getMembershipPeriod("2026-04-10", new Date("2026-03-15T00:00:00Z"))
    assert.ok(period)
    assert.equal(period!.index, 0) // 2026-04-10 sigue dentro del primer ciclo [03-15, 04-15)
    assert.equal(period!.startStr, "2026-03-15")
    assert.equal(period!.endStr, "2026-04-15")
})

test("getMembershipPeriod advances to the next cycle past the anchor day", () => {
    const period = getMembershipPeriod("2026-04-20", new Date("2026-03-15T00:00:00Z"))
    assert.ok(period)
    assert.equal(period!.index, 1)
    assert.equal(period!.startStr, "2026-04-15")
    assert.equal(period!.endStr, "2026-05-15")
})

test("getMembershipPeriod returns null before the membership starts", () => {
    const period = getMembershipPeriod("2026-02-28", new Date("2026-03-15T00:00:00Z"))
    assert.equal(period, null)
})

test("monthly summary counts only classes used in the current cycle", () => {
    const ticket = makeTicket("2026-03-01", 20, [
        "2026-03-05",
        "2026-03-10",
        "2026-03-20",
        "2026-04-02",
    ])
    assert.deepEqual(buildMembershipMonthlySummary(ticket, "2026-03-15"), {
        total: 20,
        used: 3,
        remaining: 17,
    })
    // Al cambiar de mes el conteo se reinicia (use-it-or-lose-it)
    assert.deepEqual(buildMembershipMonthlySummary(ticket, "2026-04-10"), {
        total: 20,
        used: 1,
        remaining: 19,
    })
})

test("monthly summary blocks when the cycle quota is exhausted", () => {
    const usedDates = Array.from(
        { length: 20 },
        (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`
    )
    const ticket = makeTicket("2026-03-01", 20, usedDates)
    assert.equal(buildMembershipMonthlySummary(ticket, "2026-03-25").remaining, 0)
})

// ==================== TÉRMINO FIJO (anual / semestral) ====================

test("isBlackoutMonth flags January and February by default", () => {
    assert.equal(isBlackoutMonth(1), true)
    assert.equal(isBlackoutMonth(2), true)
    assert.equal(isBlackoutMonth(3), false)
    assert.equal(isBlackoutMonth(12), false)
})

test("isFixedTermMembership requires chosen start date AND duration", () => {
    const fixed = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-09-15",
        membershipDurationMonths: 12,
    })
    assert.equal(isFixedTermMembership(fixed), true)

    // Legacy: sin fecha de inicio ni duración → NO es a término fijo
    const legacy = makeTicket("2026-07-01", 20, [])
    assert.equal(isFixedTermMembership(legacy), false)

    // Con fecha pero sin duración → tampoco
    const partial = makeTicket("2026-07-01", 20, [], { membershipStartDate: "2026-09-15" })
    assert.equal(isFixedTermMembership(partial), false)
})

test("event fixed start makes an existing missing-start ticket fixed-term", () => {
    const ticket = makeTicket("2026-06-25", 12, [], {
        membershipStartFixed: "2026-08-01",
        membershipDurationMonths: 6,
    })

    assert.equal(isFixedTermMembership(ticket), true)
    assert.equal(getMembershipAnchor(ticket)?.toISOString().slice(0, 10), "2026-08-01")

    const access = getMembershipAccessStatus(ticket, "2026-06-27")
    assert.equal(access.status, "NOT_STARTED")
    assert.equal(access.startStr, "2026-08-01")
    assert.deepEqual(buildMembershipMonthlySummary(ticket, "2026-06-27"), {
        total: 12,
        used: 0,
        remaining: 12,
    })
})

test("getMembershipExpiry extends an annual membership over the Jan/Feb blackout", () => {
    // 12 meses activos desde 2026-03-15, saltando ene/feb → vence 2027-05-15 (exclusivo)
    const expiry = getMembershipExpiry(new Date("2026-03-15T12:00:00Z"), 12)
    assert.equal(expiry, "2027-05-15")
})

test("getMembershipExpiry extends a semestral membership over the blackout", () => {
    // 6 meses activos desde 2026-10-01: Oct,Nov,Dic + (salta ene,feb) + Mar,Abr,May
    // → vence 2027-06-01 (exclusivo)
    const expiry = getMembershipExpiry(new Date("2026-10-01T12:00:00Z"), 6)
    assert.equal(expiry, "2027-06-01")
})

test("getMembershipExpiry without blackout overlap is a plain month add", () => {
    // 6 meses desde 2026-03-01 sin cruzar ene/feb → 2026-09-01
    const expiry = getMembershipExpiry(new Date("2026-03-01T12:00:00Z"), 6)
    assert.equal(expiry, "2026-09-01")
})

test("getMembershipExpiry extends one calendar month for a membership freeze", () => {
    const expiry = getMembershipExpiry(new Date("2026-03-01T12:00:00Z"), 6, undefined, [
        { month: "2026-08", startStr: "2026-08-01", endStr: "2026-09-01" },
    ])
    assert.equal(expiry, "2026-10-01")
})

test("isWithinMembershipWindow respects start, expiry and blackout", () => {
    const ticket = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-03-15",
        membershipDurationMonths: 12,
    })
    // Día normal dentro de la vigencia
    assert.equal(isWithinMembershipWindow(ticket, "2026-03-20"), true)
    // Antes del inicio elegido
    assert.equal(isWithinMembershipWindow(ticket, "2026-03-10"), false)
    // Dentro de la ventana pero en enero (blackout)
    assert.equal(isWithinMembershipWindow(ticket, "2027-01-15"), false)
    // Pasada la expiración (2027-05-15 exclusivo)
    assert.equal(isWithinMembershipWindow(ticket, "2027-05-20"), false)
})

test("getMembershipAccessStatus distinguishes blackout, not-started and expired", () => {
    const ticket = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-03-15",
        membershipDurationMonths: 12,
    })
    assert.equal(getMembershipAccessStatus(ticket, "2026-03-20").status, "OK")
    assert.equal(getMembershipAccessStatus(ticket, "2026-03-10").status, "NOT_STARTED")
    assert.equal(getMembershipAccessStatus(ticket, "2027-02-10").status, "BLACKOUT")
    assert.equal(getMembershipAccessStatus(ticket, "2027-05-15").status, "EXPIRED")

    // Legacy no es a término fijo → NOT_APPLICABLE (usa la lógica de evento)
    const legacy = makeTicket("2026-07-01", 20, [])
    assert.equal(getMembershipAccessStatus(legacy, "2026-07-10").status, "NOT_APPLICABLE")
})

test("getMembershipAccessStatus returns FROZEN during the freeze month", () => {
    const ticket = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-03-01",
        membershipDurationMonths: 6,
        membershipFreeze: {
            month: "2026-08",
            startDate: "2026-08-01",
            endDate: "2026-09-01",
        },
    })

    const access = getMembershipAccessStatus(ticket, "2026-08-15")
    assert.equal(access.status, "FROZEN")
    assert.equal(access.expiryStr, "2026-10-01")
    assert.equal(access.freeze?.month, "2026-08")
})

test("validateMembershipFreezeMonth rejects January and February", () => {
    const ticket = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-03-01",
        membershipDurationMonths: 12,
    })

    const result = validateMembershipFreezeMonth(ticket, "2027-01", new Date("2026-12-20T12:00:00Z"))
    assert.equal(result.ok, false)
    if (!result.ok) {
        assert.match(result.error, /Enero y febrero/)
    }
})

test("validateMembershipFreezeMonth requires 48 hours notice", () => {
    const ticket = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-03-01",
        membershipDurationMonths: 12,
    })

    const result = validateMembershipFreezeMonth(ticket, "2026-08", new Date("2026-07-30T06:00:00Z"))
    assert.equal(result.ok, false)
    if (!result.ok) {
        assert.match(result.error, /48 horas/)
    }
})

test("validateMembershipFreezeMonth caps voluntary freezes at November of the start year", () => {
    const ticket = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-08-01",
        membershipDurationMonths: 6,
    })

    const result = validateMembershipFreezeMonth(ticket, "2027-03", new Date("2026-08-05T12:00:00Z"))
    assert.equal(result.ok, false)
    if (!result.ok) {
        assert.match(result.error, /noviembre de 2026/)
    }
})

test("getEligibleMembershipFreezeMonths does not offer months after November", () => {
    const ticket = makeTicket("2026-07-01", 20, [], {
        membershipStartDate: "2026-08-01",
        membershipDurationMonths: 6,
    })

    const months = getEligibleMembershipFreezeMonths(ticket, new Date("2026-07-01T12:00:00Z")).map(
        (range) => range.month
    )

    assert.deepEqual(months, ["2026-08", "2026-09", "2026-10", "2026-11"])
})

test("fixed-term membership anchors the monthly cycle to the chosen start date", () => {
    // Inicio elegido 2026-09-10; el corte mensual cae el día 10.
    const ticket = makeTicket("2026-07-01", 8, ["2026-09-12", "2026-09-15", "2026-10-20"], {
        membershipStartDate: "2026-09-10",
        membershipDurationMonths: 12,
    })
    // 2026-09-20 está en el ciclo [09-10, 10-10): cuentan 09-12 y 09-15 (no 10-20)
    assert.deepEqual(buildMembershipMonthlySummary(ticket, "2026-09-20"), {
        total: 8,
        used: 2,
        remaining: 6,
    })
    // 2026-10-20 está en el ciclo [10-10, 11-10): solo cuenta 10-20 (reinicio)
    assert.deepEqual(buildMembershipMonthlySummary(ticket, "2026-10-20"), {
        total: 8,
        used: 1,
        remaining: 7,
    })
})

test("membershipAllowsMultipleDailyScans solo aplica a membresías con el flag", () => {
    const oro = makeTicket("2026-07-01", 60, [], { allowMultipleDailyScans: true })
    assert.equal(membershipAllowsMultipleDailyScans(oro), true)

    // Membresía sin el flag
    const plata = makeTicket("2026-07-01", 20, [])
    assert.equal(membershipAllowsMultipleDailyScans(plata), false)

    // Con el flag pero SIN cupo mensual (no es membresía) → false
    const noMembership = makeTicket("2026-07-01", 0, [], { allowMultipleDailyScans: true })
    assert.equal(membershipAllowsMultipleDailyScans(noMembership), false)
})

test("legacy membership (no chosen start) still anchors to the event start", () => {
    const legacy = makeTicket("2026-03-01", 20, ["2026-03-05", "2026-03-10"])
    // Mismo comportamiento que antes: anclado a event.startDate
    assert.deepEqual(buildMembershipMonthlySummary(legacy, "2026-03-15"), {
        total: 20,
        used: 2,
        remaining: 18,
    })
})
