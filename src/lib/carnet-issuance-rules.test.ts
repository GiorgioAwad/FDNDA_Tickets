import assert from "node:assert/strict"
import test from "node:test"

import { validateCarnetRequest, type CarnetValidationContext } from "./carnet-issuance-rules"

const baseTicketType: CarnetValidationContext["ticketType"] = {
    id: "tt_bronce",
    name: "MEMBRESIA SEMESTRAL BRONCE",
    isActive: true,
    capacity: 100,
    sold: 10,
    monthlyClassLimit: 12,
    membershipDurationMonths: 6,
    membershipScheduleKey: "BRONCE",
    isPackage: false,
    packageDaysCount: null,
    capacityByDate: false,
    validDays: null,
    eventId: "ev_cm",
    event: {
        id: "ev_cm",
        title: "Membresias Campo de Marte 2026",
        category: "ACADEMIA",
        servilexSucursalCode: "01",
        startDate: new Date(Date.UTC(2026, 0, 1, 12)),
        endDate: new Date(Date.UTC(2026, 11, 31, 12)),
        membershipStartFixed: null,
        membershipStartMin: null,
        membershipStartMax: null,
    },
}

/** Overrides con `input` parcial, para que cada test toque solo lo suyo. */
type CtxOverrides = Omit<Partial<CarnetValidationContext>, "input"> & {
    input?: Partial<CarnetValidationContext["input"]>
}

function makeCtx(overrides: CtxOverrides = {}): CarnetValidationContext {
    const { input: inputOverrides, ...rest } = overrides
    return {
        user: { id: "u1", email: "alumno@example.com", name: "Ana Torres" },
        ticketType: baseTicketType,
        existingActiveTicketCode: null,
        duplicateOrderId: null,
        dateInventory: [],
        ...rest,
        // `input` se arma al final para que un override parcial se fusione con
        // los defaults en vez de reemplazarlos.
        input: {
            userId: "u1",
            ticketTypeId: "tt_bronce",
            attendeeDni: "12345678",
            amountPaid: 0,
            membershipStartDate: "2026-09-01",
            membershipSchedule: { category: "ADULTOS", frequency: "LMV", hours: { main: "07:00-08:00" } },
            sourceRef: "panel:u1:tt_bronce:1",
            reason: "Regularizacion de inscrito presencial",
            ...inputOverrides,
        },
    }
}

const errorsOf = (result: ReturnType<typeof validateCarnetRequest>) =>
    result.ok ? [] : result.errors

test("una membresia con horario valido produce un plan", () => {
    const result = validateCarnetRequest(makeCtx())
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.plan.membershipStartDate, "2026-09-01")
    assert.equal(result.plan.membershipSchedule?.profileKey, "BRONCE")
    assert.equal(result.plan.membershipSchedule?.sessions.length, 3) // L, M, V
    assert.equal(result.plan.attendeeName, "Ana Torres") // default: nombre del usuario
    assert.deepEqual(result.plan.entitlementDates, []) // cupo mensual: no pre-genera
    assert.equal(result.plan.providerOrderNumber, "PRES-panel:u1:tt_bronce:1")
})

test("falta el motivo", () => {
    const result = validateCarnetRequest(makeCtx({ input: { reason: "  " } }))
    assert.match(errorsOf(result).join(" "), /motivo/i)
})

test("un tipo de entrada inactivo se rechaza", () => {
    const result = validateCarnetRequest(
        makeCtx({ ticketType: { ...baseTicketType, isActive: false } })
    )
    assert.match(errorsOf(result).join(" "), /inactivo/i)
})

test("enero y febrero estan bloqueados como inicio de membresia", () => {
    const result = validateCarnetRequest(
        makeCtx({ input: { membershipStartDate: "2027-01-05" } })
    )
    assert.match(errorsOf(result).join(" "), /enero|febrero/i)
})

test("el inicio no puede caer fuera del rango del evento", () => {
    const ticketType = {
        ...baseTicketType,
        event: {
            ...baseTicketType.event,
            membershipStartMin: new Date(Date.UTC(2026, 8, 1, 12)),
            membershipStartMax: new Date(Date.UTC(2026, 8, 30, 12)),
        },
    }
    const result = validateCarnetRequest(
        makeCtx({ ticketType, input: { membershipStartDate: "2026-10-15" } })
    )
    assert.match(errorsOf(result).join(" "), /2026-09-30/)
})

test("una membresia con perfil de horario exige la seleccion", () => {
    const result = validateCarnetRequest(makeCtx({ input: { membershipSchedule: null } }))
    assert.equal(result.ok, false)
    assert.ok(errorsOf(result).length > 0)
})

test("una hora que no esta en el catalogo de la sede se rechaza", () => {
    const result = validateCarnetRequest(
        makeCtx({
            input: {
                membershipSchedule: { category: "ADULTOS", frequency: "LMV", hours: { main: "23:00-23:30" } },
            },
        })
    )
    assert.match(errorsOf(result).join(" "), /no est/i)
})

test("un carnet activo duplicado bloquea, salvo override explicito", () => {
    const blocked = validateCarnetRequest(makeCtx({ existingActiveTicketCode: "ABC12345" }))
    assert.equal(blocked.ok, false)
    assert.match(errorsOf(blocked).join(" "), /ABC12345/)

    const allowed = validateCarnetRequest(
        makeCtx({ existingActiveTicketCode: "ABC12345", input: { allowExistingActive: true } })
    )
    assert.equal(allowed.ok, true)
    if (allowed.ok) assert.ok(allowed.plan.warnings.some((w) => /ABC12345/.test(w)))
})

test("un sourceRef ya emitido bloquea", () => {
    const result = validateCarnetRequest(makeCtx({ duplicateOrderId: "ord_1" }))
    assert.match(errorsOf(result).join(" "), /ya se emiti/i)
})

test("sin cupo global se rechaza, y forceCapacity lo deja pasar con aviso", () => {
    const full = { ...baseTicketType, capacity: 10, sold: 10 }
    const blocked = validateCarnetRequest(makeCtx({ ticketType: full }))
    assert.match(errorsOf(blocked).join(" "), /cupo/i)

    const forced = validateCarnetRequest(
        makeCtx({ ticketType: full, input: { forceCapacity: true } })
    )
    assert.equal(forced.ok, true)
    if (forced.ok) {
        assert.equal(forced.plan.forcedGlobalCapacity, true)
        // Este ticketType no usa cupo por fecha: el otro gate nunca se activa.
        assert.equal(forced.plan.forcedDateCapacity, false)
        assert.ok(forced.plan.warnings.some((w) => /sobrecupo/i.test(w)))
    }
})

test("forzar el cupo global lleno no marca el cupo por fecha si ese dia tiene sitio", () => {
    // tope global lleno (10/10) + cupo del dia CON espacio (5/30): forzar el
    // primero no debe activar el segundo gate, que es independiente.
    const poolType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pool_full",
        name: "PISCINA LIBRE 3-4 PM",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        capacity: 10,
        sold: 10,
        event: { ...baseTicketType.event, category: "PISCINA_LIBRE" },
    }
    const result = validateCarnetRequest(
        makeCtx({
            ticketType: poolType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_pool_full",
                sourceRef: "panel:u1:tt_pool_full:1",
                reason: "Cortesia",
                membershipStartDate: null,
                membershipSchedule: null,
                scheduleSelections: [{ date: "2026-09-02" }],
                forceCapacity: true,
            },
            dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 5, isEnabled: true }],
        })
    )
    assert.equal(result.ok, true)
    if (result.ok) {
        assert.equal(result.plan.forcedGlobalCapacity, true)
        assert.equal(result.plan.forcedDateCapacity, false)
    }
})

test("piscina libre exige fecha y respeta el inventario del dia", () => {
    const poolType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pool",
        name: "PISCINA LIBRE 3-4 PM",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        event: { ...baseTicketType.event, category: "PISCINA_LIBRE" },
    }
    const poolInput = {
        userId: "u1",
        ticketTypeId: "tt_pool",
        sourceRef: "panel:u1:tt_pool:1",
        reason: "Cortesia",
        membershipStartDate: null,
        membershipSchedule: null,
    }

    const sinFecha = validateCarnetRequest(
        makeCtx({ ticketType: poolType, input: poolInput })
    )
    assert.match(errorsOf(sinFecha).join(" "), /fecha/i)

    // Fecha elegida sin fila de inventario: el preview debe rechazarla, no
    // dejarla pasar en limpio y fallar recien en la escritura.
    const sinInventario = validateCarnetRequest(
        makeCtx({
            ticketType: poolType,
            input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }] },
            dateInventory: [],
        })
    )
    assert.equal(sinInventario.ok, false)
    assert.match(errorsOf(sinInventario).join(" "), /no hay inventario configurado/i)

    const cerrada = validateCarnetRequest(
        makeCtx({
            ticketType: poolType,
            input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }] },
            dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 0, isEnabled: false }],
        })
    )
    assert.match(errorsOf(cerrada).join(" "), /cerrad/i)

    const llena = makeCtx({
        ticketType: poolType,
        input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }] },
        dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 30, isEnabled: true }],
    })
    assert.equal(validateCarnetRequest(llena).ok, false)

    // forceCapacity salta el cupo lleno...
    const forzada = validateCarnetRequest({
        ...llena,
        input: { ...llena.input, forceCapacity: true },
    })
    assert.equal(forzada.ok, true)
    if (forzada.ok) assert.deepEqual(forzada.plan.entitlementDates, ["2026-09-02"])

    // ...pero NO una fecha deshabilitada.
    const forzadaCerrada = validateCarnetRequest(
        makeCtx({
            ticketType: poolType,
            input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }], forceCapacity: true },
            dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 0, isEnabled: false }],
        })
    )
    assert.equal(forzadaCerrada.ok, false)
})

test("un EVENTO con capacityByDate exige fecha y respeta su inventario", () => {
    // Distinto de piscina libre: usesTicketDateCapacity tambien cubre EVENTO
    // cuando el ticketType tiene capacityByDate=true (checkout de produccion
    // ya lo trata asi; el panel de carnets debia hacer lo mismo).
    const eventoType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_evento_fecha",
        name: "ENTRADA GENERAL DIA 1",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        capacityByDate: true,
        event: { ...baseTicketType.event, category: "EVENTO" },
    }
    const eventoInput = {
        userId: "u1",
        ticketTypeId: "tt_evento_fecha",
        sourceRef: "panel:u1:tt_evento_fecha:1",
        reason: "Cortesia",
        membershipStartDate: null,
        membershipSchedule: null,
    }

    const sinFecha = validateCarnetRequest(makeCtx({ ticketType: eventoType, input: eventoInput }))
    assert.match(errorsOf(sinFecha).join(" "), /fecha/i)

    const sinInventario = validateCarnetRequest(
        makeCtx({
            ticketType: eventoType,
            input: { ...eventoInput, scheduleSelections: [{ date: "2026-09-02" }] },
            dateInventory: [],
        })
    )
    assert.equal(sinInventario.ok, false)
    assert.match(errorsOf(sinInventario).join(" "), /no hay inventario configurado/i)

    const llena = validateCarnetRequest(
        makeCtx({
            ticketType: eventoType,
            input: { ...eventoInput, scheduleSelections: [{ date: "2026-09-02" }] },
            dateInventory: [{ date: "2026-09-02", capacity: 50, sold: 50, isEnabled: true }],
        })
    )
    assert.equal(llena.ok, false)
    assert.match(errorsOf(llena).join(" "), /cupo/i)

    const conCupo = validateCarnetRequest(
        makeCtx({
            ticketType: eventoType,
            input: { ...eventoInput, scheduleSelections: [{ date: "2026-09-02" }] },
            dateInventory: [{ date: "2026-09-02", capacity: 50, sold: 10, isEnabled: true }],
        })
    )
    assert.equal(conCupo.ok, true)
    if (conCupo.ok) assert.deepEqual(conCupo.plan.entitlementDates, ["2026-09-02"])
})

test("un EVENTO sin capacityByDate no exige fecha por inventario", () => {
    // capacityByDate=false (default) para un EVENTO: usesTicketDateCapacity
    // devuelve false, asi que no se exige seleccion ni se valida inventario,
    // igual que antes de este fix.
    const eventoType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_evento_simple",
        name: "ENTRADA GENERAL",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        capacityByDate: false,
        event: { ...baseTicketType.event, category: "EVENTO" },
    }
    const result = validateCarnetRequest(
        makeCtx({
            ticketType: eventoType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_evento_simple",
                sourceRef: "panel:u1:tt_evento_simple:1",
                reason: "Cortesia",
                membershipStartDate: null,
                membershipSchedule: null,
            },
        })
    )
    assert.equal(result.ok, true)
})

test("un paquete al que le faltan fechas se rechaza", () => {
    const packType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pack",
        name: "PAQUETE 3 DIAS",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 3,
        event: { ...baseTicketType.event, category: "DEPORTIVO" },
    }
    const result = validateCarnetRequest(
        makeCtx({
            ticketType: packType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_pack",
                sourceRef: "panel:u1:tt_pack:1",
                reason: "Cortesia",
                membershipStartDate: null,
                membershipSchedule: null,
                scheduleSelections: [{ date: "2026-09-01" }],
            },
        })
    )
    assert.match(errorsOf(result).join(" "), /3 fecha/i)
})
