import test from "node:test"
import assert from "node:assert/strict"
import {
    planMembershipChange,
    buildMembershipChangeFingerprint,
    getAttendeeMatricula,
    type MembershipChangeSnapshot,
    type MembershipTicketTypeSnapshot,
} from "@/lib/membership-transfer"

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Horario BRONCE ninos L-M-V 15:00-16:00 en VIDENA (03). Coincide con el caso
// real de scripts/set-membership-schedule.ts.
const VIDENA_BRONCE_TYPE: MembershipTicketTypeSnapshot = {
    id: "tt-videna-bronce",
    eventId: "ev-videna",
    sucursalCode: "03",
    name: "MEMBRESIA SEMESTRAL BRONCE",
    price: 1090,
    capacity: 0,
    sold: 40,
    isActive: true,
    isPackage: false,
    monthlyClassLimit: 12,
    membershipDurationMonths: 6,
    membershipScheduleKey: "BRONCE",
}

function baseSnapshot(overrides: Partial<MembershipChangeSnapshot> = {}): MembershipChangeSnapshot {
    return {
        ticket: {
            id: "tk-1",
            status: "ACTIVE",
            eventId: "ev-videna",
            ticketTypeId: "tt-videna-bronce",
            membershipSchedule: {
                profileKey: "BRONCE",
                sucursalCode: "03",
                category: "NINOS",
                categoryLabel: "Ninos",
                frequency: "LMV",
                frequencyLabel: "Lun - Mie - Vie",
                sessions: [
                    { weekday: 1, start: "16:00", end: "17:00" },
                    { weekday: 3, start: "16:00", end: "17:00" },
                    { weekday: 5, start: "16:00", end: "17:00" },
                ],
                groups: [
                    { id: "main", label: "Lun, Mie y Vie", weekdays: [1, 3, 5], start: "16:00", end: "17:00" },
                ],
            },
            monthlyScheduleCount: 0,
        },
        order: {
            id: "or-1",
            status: "PAID",
            provider: "IZIPAY",
            invoices: [
                {
                    id: "inv-1",
                    status: "ISSUED",
                    servilexGroupKey: "AC:03:matricula:2299469",
                    invoiceNumber: "B001-123",
                },
            ],
        },
        orderItem: {
            id: "oi-1",
            ticketTypeId: "tt-videna-bronce",
            attendeeData: [{ matricula: "2299469", name: "Aylin Oriana Lachira Panta" }],
        },
        sourceType: VIDENA_BRONCE_TYPE,
        ...overrides,
    }
}

// ── getAttendeeMatricula ──────────────────────────────────────────────────────

test("getAttendeeMatricula lee la matricula del unico asistente", () => {
    assert.equal(getAttendeeMatricula([{ matricula: "2299469" }]), "2299469")
})

test("getAttendeeMatricula devuelve null si hay mas de un asistente", () => {
    assert.equal(getAttendeeMatricula([{ matricula: "1" }, { matricula: "2" }]), null)
})

test("getAttendeeMatricula devuelve null si no es un arreglo", () => {
    assert.equal(getAttendeeMatricula({ matricula: "1" }), null)
})

test("getAttendeeMatricula devuelve null si el asistente no tiene matricula", () => {
    assert.equal(getAttendeeMatricula([{ name: "Sin matricula" }]), null)
})

// ── SCHEDULE: camino feliz ────────────────────────────────────────────────────

test("SCHEDULE cambia la hora del grupo y produce las sesiones nuevas", () => {
    const plan = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.kind, "SCHEDULE")
    assert.deepEqual(plan.before.sessions, ["1:16:00-17:00", "3:16:00-17:00", "5:16:00-17:00"])
    assert.deepEqual(plan.after.sessions, ["1:15:00-16:00", "3:15:00-16:00", "5:15:00-16:00"])
})

test("SCHEDULE escribe el horario en el ticket y en el attendeeData", () => {
    const plan = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    const selection = plan.writes.ticket.membershipSchedule
    assert.ok(selection)
    assert.equal(selection.sessions.length, 3)
    // La copia del checkout va en sincronia: editar solo una de las dos no
    // cambia nada en la puerta.
    const attendees = plan.writes.orderItem.attendeeData as Array<Record<string, unknown>>
    assert.equal(attendees.length, 1)
    assert.equal(attendees[0].matricula, "2299469")
    assert.deepEqual(attendees[0].membershipSchedule, selection)
    // SCHEDULE no mueve cupo ni tipo.
    assert.equal(plan.writes.soldDecrementTypeId, undefined)
    assert.equal(plan.writes.soldIncrementTypeId, undefined)
    assert.equal(plan.writes.ticket.ticketTypeId, undefined)
})

// ── SCHEDULE: bloqueos ────────────────────────────────────────────────────────

function blockerCodes(snapshot: MembershipChangeSnapshot) {
    const plan = planMembershipChange(snapshot, {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    })
    assert.equal(plan.ok, false)
    if (plan.ok) return []
    return plan.blockers.map((b) => b.code)
}

test("SCHEDULE bloquea si el carnet no esta ACTIVE", () => {
    const snapshot = baseSnapshot()
    snapshot.ticket.status = "CANCELLED"
    assert.ok(blockerCodes(snapshot).includes("TICKET_NOT_ACTIVE"))
})

test("SCHEDULE bloquea si la orden no esta PAID", () => {
    const snapshot = baseSnapshot()
    snapshot.order.status = "PENDING"
    assert.ok(blockerCodes(snapshot).includes("ORDER_NOT_PAID"))
})

test("SCHEDULE bloquea si el carnet tiene horarios mensuales definidos", () => {
    const snapshot = baseSnapshot()
    snapshot.ticket.monthlyScheduleCount = 2
    assert.ok(blockerCodes(snapshot).includes("HAS_MONTHLY_SCHEDULES"))
})

test("SCHEDULE bloquea si el attendeeData trae mas de una persona", () => {
    const snapshot = baseSnapshot()
    snapshot.orderItem.attendeeData = [{ matricula: "1" }, { matricula: "2" }]
    assert.ok(blockerCodes(snapshot).includes("ATTENDEE_DATA_INVALID"))
})

test("SCHEDULE bloquea en una sede sin catalogo de horarios", () => {
    const snapshot = baseSnapshot()
    snapshot.sourceType = { ...VIDENA_BRONCE_TYPE, sucursalCode: "04" }
    assert.ok(blockerCodes(snapshot).includes("NO_SCHEDULE_PROFILE"))
})

test("SCHEDULE bloquea si la hora elegida no existe en el catalogo", () => {
    const plan = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "23:00-00:00" } },
    })
    assert.equal(plan.ok, false)
    if (plan.ok) return
    assert.ok(plan.blockers.some((b) => b.code === "SCHEDULE_INVALID"))
})

test("SCHEDULE acumula todos los bloqueos, no solo el primero", () => {
    const snapshot = baseSnapshot()
    snapshot.ticket.status = "EXPIRED"
    snapshot.order.status = "PENDING"
    const codes = blockerCodes(snapshot)
    assert.ok(codes.includes("TICKET_NOT_ACTIVE"))
    assert.ok(codes.includes("ORDER_NOT_PAID"))
})

// ── Fingerprint ───────────────────────────────────────────────────────────────

test("el fingerprint es estable para el mismo estado", () => {
    assert.equal(
        buildMembershipChangeFingerprint(baseSnapshot()),
        buildMembershipChangeFingerprint(baseSnapshot())
    )
})

test("el fingerprint cambia si el horario cambia", () => {
    const moved = baseSnapshot()
    moved.ticket.membershipSchedule = {
        ...(moved.ticket.membershipSchedule as Record<string, unknown>),
        sessions: [{ weekday: 1, start: "07:00", end: "08:00" }],
        groups: [{ id: "main", label: "Lun", weekdays: [1], start: "07:00", end: "08:00" }],
    }
    assert.notEqual(
        buildMembershipChangeFingerprint(baseSnapshot()),
        buildMembershipChangeFingerprint(moved)
    )
})

test("el fingerprint cambia si el contador sold del tipo origen cambia", () => {
    const sold = baseSnapshot()
    sold.sourceType = { ...VIDENA_BRONCE_TYPE, sold: 41 }
    assert.notEqual(
        buildMembershipChangeFingerprint(baseSnapshot()),
        buildMembershipChangeFingerprint(sold)
    )
})
