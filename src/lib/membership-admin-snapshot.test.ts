/**
 * Tests del traductor Prisma → snapshot puro. Se alimenta con objetos planos
 * (sin base de datos): lo que se prueba es el MAPEO, que es donde un cambio de
 * schema o un `select` mal editado rompe en silencio la vista previa y la
 * escritura al mismo tiempo.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { Prisma } from "@prisma/client"

import {
    findMembershipOrderItem,
    toChangeSnapshot,
    toTicketTypeSnapshot,
    type MembershipChangeRecord,
    type TicketTypeSnapshotRecord,
} from "@/lib/membership-admin-snapshot"
import { getAttendeeMatricula, resolveAttendeeMatricula } from "@/lib/membership-transfer"

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Los payloads de Prisma traen decenas de columnas que este modulo no lee. Se
// arma solo lo que el mapeo toca y se castea: pedirle al test el registro
// completo no probaria nada mas y lo volveria imposible de mantener.
function ticketTypeRecord(
    overrides: Partial<Record<string, unknown>> = {}
): TicketTypeSnapshotRecord {
    return {
        id: "tt-videna-plata",
        eventId: "ev-videna",
        name: "MEMBRESIA SEMESTRAL PLATA",
        // Decimal(10,2) tal como lo devuelve Prisma, no un number.
        price: new Prisma.Decimal("1240.00"),
        capacity: 0,
        sold: 25,
        isActive: true,
        isPackage: false,
        monthlyClassLimit: 20,
        membershipDurationMonths: 6,
        membershipScheduleKey: "PLATA",
        event: { id: "ev-videna", title: "Academia VIDENA", servilexSucursalCode: "03" },
        ...overrides,
    } as unknown as TicketTypeSnapshotRecord
}

function orderItem(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        id: "oi-1",
        ticketTypeId: "tt-videna-plata",
        quantity: 1,
        unitPrice: new Prisma.Decimal("1240.00"),
        attendeeData: [{ matricula: "7300631", dni: "10203040", name: "Jose Vasquez" }],
        ...overrides,
    }
}

function changeRecord(overrides: Partial<Record<string, unknown>> = {}): MembershipChangeRecord {
    return {
        id: "tk-1",
        status: "ACTIVE",
        eventId: "ev-videna",
        ticketTypeId: "tt-videna-plata",
        attendeeDni: "10203040",
        membershipSchedule: null,
        ticketType: ticketTypeRecord(),
        order: {
            id: "or-1",
            status: "PAID",
            provider: "IZIPAY",
            totalAmount: new Prisma.Decimal("1240.00"),
            buyerName: "Jose Vasquez",
            buyerDocNumber: "10203040",
            orderItems: [orderItem()],
            invoices: [
                {
                    id: "inv-1",
                    status: "ISSUED",
                    servilexGroupKey: "AC:03:matricula:7300631",
                    invoiceNumber: "B001-999",
                },
            ],
        },
        monthlySchedules: [],
        membershipFreeze: null,
        entitlements: [],
        scans: [],
        user: { id: "us-1", name: "Jose Vasquez", email: "jose@example.com" },
        ...overrides,
    } as unknown as MembershipChangeRecord
}

// ── price: Decimal → number ───────────────────────────────────────────────────

test("toTicketTypeSnapshot convierte el price Decimal de Prisma a number", () => {
    const snapshot = toTicketTypeSnapshot(ticketTypeRecord())
    // Sin esta conversion, equivalenceBlockers compararia un Decimal contra
    // otro con !== (referencias distintas) y TODO cambio de sede quedaria
    // bloqueado por "precio no equivalente".
    assert.equal(typeof snapshot.price, "number")
    assert.equal(snapshot.price, 1240)
})

test("dos tipos con el mismo precio Decimal salen equivalentes tras el mapeo", () => {
    const origen = toTicketTypeSnapshot(ticketTypeRecord())
    const destino = toTicketTypeSnapshot(
        ticketTypeRecord({
            id: "tt-cdm-plata",
            eventId: "ev-cdm",
            price: new Prisma.Decimal("1240.00"),
            event: { id: "ev-cdm", title: "Academia CDM", servilexSucursalCode: "01" },
        })
    )
    // La comparacion cruda que hace el planificador.
    assert.equal(origen.price === destino.price, true)
})

test("toTicketTypeSnapshot toma la sucursal del evento del tipo", () => {
    const snapshot = toTicketTypeSnapshot(
        ticketTypeRecord({
            event: { id: "ev-cdm", title: "Academia CDM", servilexSucursalCode: "01" },
        })
    )
    assert.equal(snapshot.sucursalCode, "01")
})

test("toTicketTypeSnapshot deja null la sucursal de un evento sin codigo", () => {
    const snapshot = toTicketTypeSnapshot(
        ticketTypeRecord({ event: { id: "ev-x", title: "Evento", servilexSucursalCode: null } })
    )
    assert.equal(snapshot.sucursalCode, null)
})

// ── Compra familiar: un item con quantity 2 ───────────────────────────────────

test("un OrderItem con quantity 2 y dos asistentes se mapea entero", () => {
    const record = changeRecord({
        attendeeDni: "22222222",
        order: {
            ...(changeRecord().order as unknown as Record<string, unknown>),
            orderItems: [
                orderItem({
                    quantity: 2,
                    attendeeData: [
                        { matricula: "1000001", dni: "11111111", name: "Hermano A" },
                        { matricula: "1000002", dni: "22222222", name: "Hermano B" },
                    ],
                }),
            ],
        },
    })
    const snapshot = toChangeSnapshot(record)
    assert.ok(snapshot)
    const attendees = snapshot.orderItem.attendeeData as unknown[]
    assert.equal(attendees.length, 2)
    // El planificador lo bloquea (mover el ticketTypeId del item arrastraria al
    // hermano)…
    assert.equal(getAttendeeMatricula(snapshot.orderItem.attendeeData), null)
    // …pero el diagnostico igual sabe cual de las dos matriculas es la de este
    // carnet, que es el dato con el que el admin decide si escala a ABIO.
    const resolved = resolveAttendeeMatricula(snapshot.orderItem.attendeeData, record.attendeeDni)
    assert.equal(resolved.matricula, "1000002")
    assert.equal(resolved.isFamilyPurchase, true)
})

// ── Orden con dos items del mismo tipo ────────────────────────────────────────

test("findMembershipOrderItem devuelve null si hay dos items del mismo tipo", () => {
    const record = changeRecord({
        order: {
            ...(changeRecord().order as unknown as Record<string, unknown>),
            orderItems: [orderItem({ id: "oi-1" }), orderItem({ id: "oi-2" })],
        },
    })
    assert.equal(findMembershipOrderItem(record), null)
})

test("toChangeSnapshot devuelve null si el item del carnet es ambiguo", () => {
    const record = changeRecord({
        order: {
            ...(changeRecord().order as unknown as Record<string, unknown>),
            orderItems: [orderItem({ id: "oi-1" }), orderItem({ id: "oi-2" })],
        },
    })
    // Sin item identificable no hay nada que escribir: la ruta responde 409.
    assert.equal(toChangeSnapshot(record), null)
})

test("findMembershipOrderItem ignora los items de OTROS tipos de la misma orden", () => {
    const record = changeRecord({
        order: {
            ...(changeRecord().order as unknown as Record<string, unknown>),
            orderItems: [
                orderItem({ id: "oi-otro", ticketTypeId: "tt-otro-plan" }),
                orderItem({ id: "oi-carnet" }),
            ],
        },
    })
    assert.equal(findMembershipOrderItem(record)?.id, "oi-carnet")
})

// ── Resto del mapeo ───────────────────────────────────────────────────────────

test("toChangeSnapshot copia estado, orden y comprobantes del carnet", () => {
    const snapshot = toChangeSnapshot(changeRecord())
    assert.ok(snapshot)
    assert.equal(snapshot.ticket.id, "tk-1")
    assert.equal(snapshot.ticket.status, "ACTIVE")
    assert.equal(snapshot.ticket.eventId, "ev-videna")
    assert.equal(snapshot.ticket.ticketTypeId, "tt-videna-plata")
    assert.equal(snapshot.order.status, "PAID")
    assert.equal(snapshot.order.provider, "IZIPAY")
    assert.equal(snapshot.order.invoices.length, 1)
    assert.equal(snapshot.order.invoices[0].servilexGroupKey, "AC:03:matricula:7300631")
    assert.equal(snapshot.orderItem.id, "oi-1")
    assert.equal(snapshot.sourceType.price, 1240)
})

test("toChangeSnapshot cuenta los horarios mensuales, no los copia", () => {
    const snapshot = toChangeSnapshot(
        changeRecord({
            monthlySchedules: [
                { monthIndex: 1, selection: {} },
                { monthIndex: 2, selection: {} },
            ],
        })
    )
    assert.ok(snapshot)
    // Es lo unico que mira el bloqueo HAS_MONTHLY_SCHEDULES.
    assert.equal(snapshot.ticket.monthlyScheduleCount, 2)
})
