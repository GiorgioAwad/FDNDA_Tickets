import test from "node:test"
import assert from "node:assert/strict"
import {
    planMembershipChange,
    buildMembershipChangeFingerprint,
    getAttendeeMatricula,
    isMembershipTicketType,
    resolveAttendeeMatricula,
    type MembershipChangeSnapshot,
    type MembershipTicketTypeSnapshot,
} from "@/lib/membership-transfer"
import type { MembershipScheduleInput } from "@/lib/membership-schedule"

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

// ── resolveAttendeeMatricula (compra familiar) ────────────────────────────────

test("resolveAttendeeMatricula devuelve la matricula del unico asistente", () => {
    const result = resolveAttendeeMatricula([{ matricula: "2299469", dni: "12345678" }], "87654321")
    assert.equal(result.matricula, "2299469")
    assert.equal(result.attendeeCount, 1)
    assert.equal(result.isFamilyPurchase, false)
})

test("resolveAttendeeMatricula ubica al hermano correcto por DNI", () => {
    const result = resolveAttendeeMatricula(
        [
            { matricula: "1000001", dni: "11111111", name: "Hermano A" },
            { matricula: "1000002", dni: "22222222", name: "Hermano B" },
        ],
        "22222222"
    )
    assert.equal(result.matricula, "1000002")
    assert.equal(result.attendeeCount, 2)
    // Sigue siendo compra familiar aunque se haya podido desambiguar: el
    // transfer se bloquea igual, solo el diagnostico mejora.
    assert.equal(result.isFamilyPurchase, true)
})

test("resolveAttendeeMatricula no adivina si el carnet no trae DNI", () => {
    const result = resolveAttendeeMatricula(
        [
            { matricula: "1000001", dni: "11111111" },
            { matricula: "1000002", dni: "22222222" },
        ],
        null
    )
    assert.equal(result.matricula, null)
    assert.equal(result.isFamilyPurchase, true)
})

test("resolveAttendeeMatricula no adivina si dos asistentes comparten el DNI", () => {
    const result = resolveAttendeeMatricula(
        [
            { matricula: "1000001", dni: "11111111" },
            { matricula: "1000002", dni: "11111111" },
        ],
        "11111111"
    )
    assert.equal(result.matricula, null)
    assert.equal(result.isFamilyPurchase, true)
})

test("resolveAttendeeMatricula sobre un attendeeData vacio no reporta compra familiar", () => {
    const result = resolveAttendeeMatricula(null, "11111111")
    assert.equal(result.matricula, null)
    assert.equal(result.attendeeCount, 0)
    assert.equal(result.isFamilyPurchase, false)
})

// ── isMembershipTicketType ────────────────────────────────────────────────────

test("isMembershipTicketType exige cupo mensual Y duracion", () => {
    assert.equal(
        isMembershipTicketType({ monthlyClassLimit: 12, membershipDurationMonths: 6 }),
        true
    )
    assert.equal(
        isMembershipTicketType({ monthlyClassLimit: 12, membershipDurationMonths: null }),
        false
    )
    assert.equal(
        isMembershipTicketType({ monthlyClassLimit: null, membershipDurationMonths: 6 }),
        false
    )
    assert.equal(isMembershipTicketType({ monthlyClassLimit: 0, membershipDurationMonths: 0 }), false)
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

// ── Fingerprint: la intencion, no solo el estado ──────────────────────────────

test("el fingerprint es estable para la misma intencion de horario", () => {
    const intent = {
        kind: "SCHEDULE" as const,
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    }
    assert.equal(
        buildMembershipChangeFingerprint(baseSnapshot(), intent),
        buildMembershipChangeFingerprint(baseSnapshot(), intent)
    )
})

test("el fingerprint no depende del orden de las claves de horas", () => {
    const a = {
        kind: "SCHEDULE" as const,
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { a: "07:00-08:00", b: "08:00-09:00" } },
    }
    const b = {
        kind: "SCHEDULE" as const,
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { b: "08:00-09:00", a: "07:00-08:00" } },
    }
    assert.equal(
        buildMembershipChangeFingerprint(baseSnapshot(), a),
        buildMembershipChangeFingerprint(baseSnapshot(), b)
    )
})

test("el fingerprint cambia si cambia la hora elegida", () => {
    assert.notEqual(
        buildMembershipChangeFingerprint(baseSnapshot(), {
            kind: "SCHEDULE",
            scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
        }),
        buildMembershipChangeFingerprint(baseSnapshot(), {
            kind: "SCHEDULE",
            scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "16:00-17:00" } },
        })
    )
})

test("el fingerprint cambia si cambia el tipo de entrada destino", () => {
    assert.notEqual(
        buildMembershipChangeFingerprint(plataSnapshot(), {
            kind: "TRANSFER",
            targetType: CDM_PLATA_TYPE,
            scheduleInput: null,
        }),
        buildMembershipChangeFingerprint(plataSnapshot(), {
            kind: "TRANSFER",
            targetType: { ...CDM_PLATA_TYPE, id: "tt-otra-sede" },
            scheduleInput: null,
        })
    )
})

test("el plan de horario sella su intencion en la huella que devuelve", () => {
    // Es la huella que la UI reenvia al aplicar: si el body cambia la seleccion
    // entre la vista previa y el "Aplicar", la replanificacion produce otra
    // huella y la ruta aborta en vez de escribir algo que nadie previsualizo.
    const a = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "15:00-16:00" } },
    })
    const b = planMembershipChange(baseSnapshot(), {
        kind: "SCHEDULE",
        scheduleInput: { category: "NINOS", frequency: "LMV", hours: { main: "16:00-17:00" } },
    })
    assert.equal(a.ok && b.ok, true)
    if (!a.ok || !b.ok) return
    assert.notEqual(a.fingerprint, b.fingerprint)
})

test("el plan de transfer sella el tipo destino en la huella que devuelve", () => {
    const a = transferPlan(plataSnapshot(), CDM_PLATA_TYPE)
    const b = transferPlan(plataSnapshot(), { ...CDM_PLATA_TYPE, id: "tt-cdm-plata-2" })
    assert.equal(a.ok && b.ok, true)
    if (!a.ok || !b.ok) return
    assert.notEqual(a.fingerprint, b.fingerprint)
})

// ── TRANSFER ──────────────────────────────────────────────────────────────────

// Campo de Marte (01), PLATA L-V. Equivalente en todo salvo la sede: es el
// destino valido de un carnet PLATA de VIDENA.
const CDM_PLATA_TYPE: MembershipTicketTypeSnapshot = {
    id: "tt-cdm-plata",
    eventId: "ev-cdm",
    sucursalCode: "01",
    name: "MEMBRESIA SEMESTRAL PLATA",
    price: 1240,
    capacity: 0,
    sold: 10,
    isActive: true,
    isPackage: false,
    monthlyClassLimit: 20,
    membershipDurationMonths: 6,
    membershipScheduleKey: "PLATA",
}

const VIDENA_PLATA_TYPE: MembershipTicketTypeSnapshot = {
    ...CDM_PLATA_TYPE,
    id: "tt-videna-plata",
    eventId: "ev-videna",
    sucursalCode: "03",
    sold: 25,
}

/** Caso Jose Vasquez: compro VIDENA, asiste en CDM; L-V 7-8am existe en ambas. */
function plataSnapshot(): MembershipChangeSnapshot {
    return {
        ticket: {
            id: "tk-2",
            status: "ACTIVE",
            eventId: "ev-videna",
            ticketTypeId: "tt-videna-plata",
            membershipSchedule: {
                profileKey: "PLATA",
                sucursalCode: "03",
                category: "ADULTOS",
                categoryLabel: "Adultos",
                frequency: "LV",
                frequencyLabel: "Lun a Vie",
                sessions: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "07:00", end: "08:00" })),
                groups: [
                    { id: "main", label: "Lun a Vie", weekdays: [1, 2, 3, 4, 5], start: "07:00", end: "08:00" },
                ],
            },
            monthlyScheduleCount: 0,
        },
        order: {
            id: "or-2",
            status: "PAID",
            provider: "IZIPAY",
            invoices: [
                {
                    id: "inv-2",
                    status: "ISSUED",
                    servilexGroupKey: "AC:03:matricula:7300631",
                    invoiceNumber: "B001-999",
                },
            ],
        },
        orderItem: {
            id: "oi-2",
            ticketTypeId: "tt-videna-plata",
            attendeeData: [{ matricula: "7300631", name: "Jose Francisco Vasquez Hiyo" }],
        },
        sourceType: VIDENA_PLATA_TYPE,
    }
}

function transferPlan(
    snapshot: MembershipChangeSnapshot,
    targetType: MembershipTicketTypeSnapshot = CDM_PLATA_TYPE,
    scheduleInput: MembershipScheduleInput | null = null
) {
    return planMembershipChange(snapshot, { kind: "TRANSFER", targetType, scheduleInput })
}

function transferBlockers(
    snapshot: MembershipChangeSnapshot,
    targetType: MembershipTicketTypeSnapshot = CDM_PLATA_TYPE
) {
    const plan = transferPlan(snapshot, targetType)
    assert.equal(plan.ok, false)
    if (plan.ok) return []
    return plan.blockers.map((b) => b.code)
}

test("TRANSFER entre eventos mueve tipo, evento y cupo", () => {
    const plan = transferPlan(plataSnapshot())
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.kind, "TRANSFER")
    assert.equal(plan.label, "Cambio de sede")
    assert.equal(plan.writes.ticket.eventId, "ev-cdm")
    assert.equal(plan.writes.ticket.ticketTypeId, "tt-cdm-plata")
    assert.equal(plan.writes.orderItem.ticketTypeId, "tt-cdm-plata")
    assert.equal(plan.writes.soldDecrementTypeId, "tt-videna-plata")
    assert.equal(plan.writes.soldIncrementTypeId, "tt-cdm-plata")
})

test("TRANSFER reescribe el horario con la sucursal destino", () => {
    const plan = transferPlan(plataSnapshot())
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    // Mismas horas, pero la seleccion queda sellada con la sede nueva.
    assert.equal(plan.writes.ticket.membershipSchedule?.sucursalCode, "01")
    assert.deepEqual(plan.after.sessions, [
        "1:07:00-08:00",
        "2:07:00-08:00",
        "3:07:00-08:00",
        "4:07:00-08:00",
        "5:07:00-08:00",
    ])
})

test("TRANSFER exige horario nuevo si el actual no existe en la sede destino", () => {
    const snapshot = plataSnapshot()
    // 23:00-00:00 no esta en el catalogo PLATA de ninguna sede.
    snapshot.ticket.membershipSchedule = {
        profileKey: "PLATA",
        sucursalCode: "03",
        category: "ADULTOS",
        categoryLabel: "Adultos",
        frequency: "LV",
        frequencyLabel: "Lun a Vie",
        sessions: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "23:00", end: "00:00" })),
        groups: [
            { id: "main", label: "Lun a Vie", weekdays: [1, 2, 3, 4, 5], start: "23:00", end: "00:00" },
        ],
    }
    assert.ok(transferBlockers(snapshot).includes("SCHEDULE_REQUIRED"))
})

test("TRANSFER acepta el horario nuevo cuando se indica", () => {
    const snapshot = plataSnapshot()
    const plan = transferPlan(snapshot, CDM_PLATA_TYPE, {
        category: "ADULTOS",
        frequency: "LV",
        hours: { main: "08:00-09:00" },
    })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.deepEqual(plan.after.sessions, [
        "1:08:00-09:00",
        "2:08:00-09:00",
        "3:08:00-09:00",
        "4:08:00-09:00",
        "5:08:00-09:00",
    ])
})

test("TRANSFER bloquea si el destino cuesta distinto", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, price: 890 }).includes(
            "TARGET_NOT_EQUIVALENT"
        )
    )
})

test("TRANSFER bloquea si el destino tiene otro cupo mensual de clases", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, monthlyClassLimit: 12 }).includes(
            "TARGET_NOT_EQUIVALENT"
        )
    )
})

test("TRANSFER bloquea si el destino dura distinto", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), {
            ...CDM_PLATA_TYPE,
            membershipDurationMonths: 12,
        }).includes("TARGET_NOT_EQUIVALENT")
    )
})

test("TRANSFER bloquea si el destino es paquete y el origen no", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, isPackage: true }).includes(
            "TARGET_NOT_EQUIVALENT"
        )
    )
})

test("TRANSFER bloquea si el destino es de otro plan", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), {
            ...CDM_PLATA_TYPE,
            membershipScheduleKey: "BRONCE",
        }).includes("TARGET_NOT_EQUIVALENT")
    )
})

test("TRANSFER bloquea si el destino esta inactivo", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, isActive: false }).includes(
            "TARGET_INACTIVE"
        )
    )
})

test("TRANSFER bloquea si el destino esta lleno", () => {
    assert.ok(
        transferBlockers(plataSnapshot(), { ...CDM_PLATA_TYPE, capacity: 10, sold: 10 }).includes(
            "TARGET_FULL"
        )
    )
})

test("TRANSFER permite capacity 0 (sin tope) aunque sold sea alto", () => {
    const plan = transferPlan(plataSnapshot(), { ...CDM_PLATA_TYPE, capacity: 0, sold: 9999 })
    assert.equal(plan.ok, true)
})

test("TRANSFER bloquea si el contador sold del origen ya esta en cero", () => {
    const snapshot = plataSnapshot()
    snapshot.sourceType = { ...VIDENA_PLATA_TYPE, sold: 0 }
    assert.ok(transferBlockers(snapshot).includes("SOURCE_SOLD_EMPTY"))
})

test("TRANSFER bloquea si el destino es el mismo tipo que el origen", () => {
    assert.ok(transferBlockers(plataSnapshot(), VIDENA_PLATA_TYPE).includes("TARGET_SAME_AS_SOURCE"))
})

// ── Deriva entre Ticket.eventId y TicketType.eventId ──────────────────────────

test("TRANSFER bloquea si el carnet y su tipo de entrada apuntan a eventos distintos", () => {
    const snapshot = plataSnapshot()
    // El carnet quedo en otro evento que su propio tipo (deriva previa).
    snapshot.ticket.eventId = "ev-cdm"
    assert.ok(transferBlockers(snapshot).includes("TICKET_EVENT_DRIFT"))
})

test("con deriva, el destino en el evento del ticket NO se toma por 'mismo evento'", () => {
    // Sin el bloqueo, `sameEvent` decidido contra sourceType.eventId daria
    // false y el plan reescribiria el ticketTypeId dejando el eventId roto: el
    // carnet quedaria a medio mover, en silencio.
    const snapshot = plataSnapshot()
    snapshot.ticket.eventId = "ev-cdm"
    const plan = transferPlan(snapshot, CDM_PLATA_TYPE)
    assert.equal(plan.ok, false)
})

test("sin deriva, el mismo evento del ticket no reescribe eventId", () => {
    const plan = transferPlan(plataSnapshot(), { ...CDM_PLATA_TYPE, eventId: "ev-videna" })
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.writes.ticket.eventId, undefined)
    assert.equal(plan.label, "Cambio de horario (la franja es el tipo de entrada)")
})

// ── Comprobante segun el origen de la venta ───────────────────────────────────

test("IZIPAY sin boleta emitida de la matricula bloquea", () => {
    const snapshot = plataSnapshot()
    snapshot.order.invoices = []
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

test("IZIPAY con boleta de OTRA matricula bloquea", () => {
    const snapshot = plataSnapshot()
    snapshot.order.invoices = [
        { id: "inv-x", status: "ISSUED", servilexGroupKey: "AC:03:matricula:0000001", invoiceNumber: "B001-1" },
    ]
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

test("IZIPAY con boleta no emitida bloquea", () => {
    const snapshot = plataSnapshot()
    snapshot.order.invoices = [
        { id: "inv-y", status: "PENDING", servilexGroupKey: "AC:03:matricula:7300631", invoiceNumber: null },
    ]
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

test("PRESENCIAL no consulta comprobantes: en venta presencial no se emite boleta", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "PRESENCIAL"
    snapshot.order.invoices = []
    const plan = transferPlan(snapshot)
    assert.equal(plan.ok, true)
})

test("COURTESY no consulta comprobantes", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "COURTESY"
    snapshot.order.invoices = []
    const plan = transferPlan(snapshot)
    assert.equal(plan.ok, true)
})

test("MOCK bloquea: viene del incidente de pagos simulados en produccion", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "MOCK"
    assert.ok(transferBlockers(snapshot).includes("ORDER_PROVIDER_MOCK"))
})

test("un provider desconocido exige boleta, como IZIPAY", () => {
    const snapshot = plataSnapshot()
    snapshot.order.provider = "PASARELA_NUEVA"
    snapshot.order.invoices = []
    assert.ok(transferBlockers(snapshot).includes("INVOICE_MISSING"))
})

// ── TRANSFER dentro del mismo evento (VMT) ────────────────────────────────────

const VMT_LMV_4PM: MembershipTicketTypeSnapshot = {
    id: "tt-vmt-lmv-4pm",
    eventId: "ev-vmt",
    sucursalCode: "04",
    name: "LUN - MIE - VIE 4PM A 5PM",
    price: 700,
    capacity: 30,
    sold: 12,
    isActive: true,
    isPackage: false,
    monthlyClassLimit: 12,
    membershipDurationMonths: 6,
    membershipScheduleKey: null,
}

const VMT_MJS_5PM: MembershipTicketTypeSnapshot = {
    ...VMT_LMV_4PM,
    id: "tt-vmt-mjs-5pm",
    name: "MAR - JUE - SAB 5PM A 6PM",
    sold: 8,
}

function vmtSnapshot(): MembershipChangeSnapshot {
    return {
        ticket: {
            id: "tk-3",
            status: "ACTIVE",
            eventId: "ev-vmt",
            ticketTypeId: "tt-vmt-lmv-4pm",
            membershipSchedule: null,
            monthlyScheduleCount: 0,
        },
        order: {
            id: "or-3",
            status: "PAID",
            provider: "PRESENCIAL",
            invoices: [],
        },
        orderItem: {
            id: "oi-3",
            ticketTypeId: "tt-vmt-lmv-4pm",
            attendeeData: [{ matricula: "9001122", name: "Alumno VMT" }],
        },
        sourceType: VMT_LMV_4PM,
    }
}

test("TRANSFER dentro del mismo evento se etiqueta como cambio de horario", () => {
    const plan = transferPlan(vmtSnapshot(), VMT_MJS_5PM)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.label, "Cambio de horario (la franja es el tipo de entrada)")
    assert.equal(plan.writes.ticket.ticketTypeId, "tt-vmt-mjs-5pm")
    // Mismo evento: no se reescribe eventId.
    assert.equal(plan.writes.ticket.eventId, undefined)
    assert.equal(plan.writes.soldDecrementTypeId, "tt-vmt-lmv-4pm")
    assert.equal(plan.writes.soldIncrementTypeId, "tt-vmt-mjs-5pm")
})

test("TRANSFER en sede sin catalogo no toca membershipSchedule", () => {
    const plan = transferPlan(vmtSnapshot(), VMT_MJS_5PM)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.writes.ticket.membershipSchedule, undefined)
    assert.equal(plan.writes.orderItem.attendeeData, undefined)
})

test("TRANSFER refleja los contadores sold de origen y destino en el plan", () => {
    const plan = transferPlan(vmtSnapshot(), VMT_MJS_5PM)
    assert.equal(plan.ok, true)
    if (!plan.ok) return
    assert.equal(plan.before.sourceSold, 12)
    assert.equal(plan.before.targetSold, 8)
    assert.equal(plan.after.sourceSold, 11)
    assert.equal(plan.after.targetSold, 9)
})
