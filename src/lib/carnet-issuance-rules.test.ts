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

test("un paquete EVENTO+capacityByDate valida CADA fecha, no solo la primera", () => {
    // packageDaysCount=2: la primera fecha tiene cupo, la segunda esta llena.
    // Antes del fix solo se miraba selections[0] y esto pasaba en limpio.
    const packEventoType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pack_evento",
        name: "PASE 2 DIAS",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 2,
        capacityByDate: true,
        event: { ...baseTicketType.event, category: "EVENTO" },
    }
    const packInput = {
        userId: "u1",
        ticketTypeId: "tt_pack_evento",
        sourceRef: "panel:u1:tt_pack_evento:1",
        reason: "Cortesia",
        membershipStartDate: null,
        membershipSchedule: null,
        scheduleSelections: [{ date: "2026-09-02" }, { date: "2026-09-03" }],
    }
    const dateInventory = [
        { date: "2026-09-02", capacity: 50, sold: 10, isEnabled: true }, // con cupo
        { date: "2026-09-03", capacity: 50, sold: 50, isEnabled: true }, // llena
    ]

    const rechazado = validateCarnetRequest(
        makeCtx({ ticketType: packEventoType, input: packInput, dateInventory })
    )
    assert.equal(rechazado.ok, false)
    if (!rechazado.ok) {
        // Nombra la fecha llena (la segunda), no solo la primera.
        assert.ok(rechazado.errors.some((e) => e.includes("2026-09-03")))
        // La primera fecha (con cupo) no genero ningun error propio.
        assert.ok(!rechazado.errors.some((e) => /2026-09-02.*cupo|cupo.*2026-09-02/.test(e)))
    }

    // forceCapacity acepta el paquete completo y marca el gate de fecha.
    const forzado = validateCarnetRequest(
        makeCtx({
            ticketType: packEventoType,
            input: { ...packInput, forceCapacity: true },
            dateInventory,
        })
    )
    assert.equal(forzado.ok, true)
    if (forzado.ok) {
        assert.equal(forzado.plan.forcedDateCapacity, true)
        assert.equal(forzado.plan.forcedGlobalCapacity, false)
        assert.ok(forzado.plan.warnings.some((w) => w.includes("2026-09-03")))
        assert.deepEqual(forzado.plan.entitlementDates, ["2026-09-02", "2026-09-03"])
    }
})

test("repetir la misma fecha en un paquete se rechaza (I-6)", () => {
    // El checkout publico rechaza repetir un dia (orders/route.ts). Aca hacia
    // falta el mismo criterio por una razon concreta: la reserva contaba la
    // repeticion (2 unidades de ese dia) pero normalizeScheduleSelections
    // deduplica por `date::shift` antes de crear los entitlements, asi que se
    // cobraba un cupo que nadie iba a poder usar.
    const packEventoType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pack_evento_dup",
        name: "PASE 2 DIAS",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 2,
        capacityByDate: true,
        event: { ...baseTicketType.event, category: "EVENTO" },
    }
    const result = validateCarnetRequest(
        makeCtx({
            ticketType: packEventoType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_pack_evento_dup",
                sourceRef: "panel:u1:tt_pack_evento_dup:1",
                reason: "Cortesia",
                membershipStartDate: null,
                membershipSchedule: null,
                scheduleSelections: [{ date: "2026-09-02" }, { date: "2026-09-02" }],
            },
            dateInventory: [{ date: "2026-09-02", capacity: 50, sold: 10, isEnabled: true }],
        })
    )
    assert.equal(result.ok, false)
    assert.match(errorsOf(result).join(" "), /no repitas la fecha 2026-09-02/i)
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

test("una fecha fuera de validDays se rechaza (I-1)", () => {
    // validDays acota el calendario del tipo de entrada. Sin este gate la
    // unica barrera era "existe fila de inventario", que no corre para un tipo
    // sin cupo por fecha: un tipeo de anio escribia entitlements fuera del
    // evento, que el panel despues no puede revocar.
    const packType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pack_validdays",
        name: "PAQUETE 2 DIAS ACADEMIA",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 2,
        capacityByDate: false,
        validDays: ["2026-09-01", "2026-09-02", "2026-09-03"],
        event: { ...baseTicketType.event, category: "ACADEMIA" },
    }
    const packInput = {
        userId: "u1",
        ticketTypeId: "tt_pack_validdays",
        sourceRef: "panel:u1:tt_pack_validdays:1",
        reason: "Regularizacion",
        membershipStartDate: null,
        membershipSchedule: null,
    }

    const fuera = validateCarnetRequest(
        makeCtx({
            ticketType: packType,
            input: {
                ...packInput,
                scheduleSelections: [{ date: "2026-09-01" }, { date: "2026-09-10" }],
            },
        })
    )
    assert.equal(fuera.ok, false)
    assert.match(errorsOf(fuera).join(" "), /2026-09-10 no es valida/i)

    const dentro = validateCarnetRequest(
        makeCtx({
            ticketType: packType,
            input: {
                ...packInput,
                scheduleSelections: [{ date: "2026-09-01" }, { date: "2026-09-02" }],
            },
        })
    )
    assert.equal(dentro.ok, true)
    if (dentro.ok) assert.deepEqual(dentro.plan.entitlementDates, ["2026-09-01", "2026-09-02"])
})

test("sin validDays, la ventana es el rango del evento (I-1)", () => {
    // El evento base va de 2026-01-01 a 2026-12-31. 2027-09-01 pasa el regex y,
    // antes del fix, escribia tres entitlements completamente fuera del evento.
    const packType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pack_rango",
        name: "PAQUETE 3 DIAS",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 3,
        validDays: null,
        event: { ...baseTicketType.event, category: "ACADEMIA" },
    }
    const result = validateCarnetRequest(
        makeCtx({
            ticketType: packType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_pack_rango",
                sourceRef: "panel:u1:tt_pack_rango:1",
                reason: "Regularizacion",
                membershipStartDate: null,
                membershipSchedule: null,
                scheduleSelections: [
                    { date: "2027-09-01" },
                    { date: "2027-09-02" },
                    { date: "2027-09-03" },
                ],
            },
        })
    )
    assert.equal(result.ok, false)
    const texto = errorsOf(result).join(" ")
    assert.match(texto, /2027-09-01 no es valida/i)
    assert.match(texto, /2027-09-03 no es valida/i)
})

test("una fecha inexistente en el calendario se rechaza, no se normaliza (I-2)", () => {
    // 2026-11-31 pasa el regex, noviembre no esta bloqueado y no hay min/max:
    // antes llegaba intacta al preview y parseDateOnly la guardaba como
    // 2026-12-01, corriendo el plazo entero de una membresia de termino fijo.
    const inicioImposible = validateCarnetRequest(
        makeCtx({ input: { membershipStartDate: "2026-11-31" } })
    )
    assert.equal(inicioImposible.ok, false)
    assert.match(errorsOf(inicioImposible).join(" "), /2026-11-31.*no es una fecha valida/i)

    // Y tambien en las fechas seleccionadas: antes se filtraban en silencio, lo
    // que desplazaba el diagnostico a "requiere 3 fechas; elegiste 2".
    const packType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pack_cal",
        name: "PAQUETE 3 DIAS",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 3,
        event: { ...baseTicketType.event, category: "ACADEMIA" },
    }
    const fechaImposible = validateCarnetRequest(
        makeCtx({
            ticketType: packType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_pack_cal",
                sourceRef: "panel:u1:tt_pack_cal:1",
                reason: "Regularizacion",
                membershipStartDate: null,
                membershipSchedule: null,
                scheduleSelections: [
                    { date: "2026-09-01" },
                    { date: "2026-09-02" },
                    { date: "2026-02-30" },
                ],
            },
        })
    )
    assert.equal(fechaImposible.ok, false)
    const texto = errorsOf(fechaImposible).join(" ")
    assert.match(texto, /2026-02-30.*no es una fecha valida/i)
    // El error habla del tipeo, no del conteo de fechas del paquete.
    assert.ok(!/requiere 3 fechas/i.test(texto))
})

test("un paquete de piscina sin packageDaysCount NO es bolsa: exige fecha (I-4)", () => {
    // Estado alcanzable desde el formulario admin de tipos de entrada:
    // isPackage=true con el conteo de dias vacio. Con el predicado debil
    // (isPackage && esPiscina) se tomaba por bolsa, se saltaban los dos gates
    // de fecha y se emitia una visita que no descontaba cupo de ningun dia.
    const poolPackType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pool_pack_nulo",
        name: "PISCINA LIBRE PAQUETE MAL CONFIGURADO",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: null,
        event: { ...baseTicketType.event, category: "PISCINA_LIBRE" },
    }
    const poolInput = {
        userId: "u1",
        ticketTypeId: "tt_pool_pack_nulo",
        sourceRef: "panel:u1:tt_pool_pack_nulo:1",
        reason: "Cortesia",
        membershipStartDate: null,
        membershipSchedule: null,
    }

    const sinFecha = validateCarnetRequest(makeCtx({ ticketType: poolPackType, input: poolInput }))
    assert.equal(sinFecha.ok, false)
    assert.match(errorsOf(sinFecha).join(" "), /elige la fecha/i)

    // Con fecha valida si emite, y esa fecha consume el cupo de su dia.
    const conFecha = validateCarnetRequest(
        makeCtx({
            ticketType: poolPackType,
            input: { ...poolInput, scheduleSelections: [{ date: "2026-09-02" }] },
            dateInventory: [{ date: "2026-09-02", capacity: 30, sold: 5, isEnabled: true }],
        })
    )
    assert.equal(conFecha.ok, true)
    if (conFecha.ok) {
        assert.equal(conFecha.plan.entitlementMode, "DATES")
        assert.deepEqual(conFecha.plan.scheduleSelections, [{ date: "2026-09-02", shift: null }])
        assert.deepEqual(conFecha.plan.entitlementDates, ["2026-09-02"])
    }
})

test("una bolsa de piscina real no reserva fechas aunque el cuerpo las traiga (I-4/I-6)", () => {
    const bagType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_pool_bag",
        name: "BOLSA 10 VISITAS",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        isPackage: true,
        packageDaysCount: 10,
        event: { ...baseTicketType.event, category: "PISCINA_LIBRE" },
    }
    const result = validateCarnetRequest(
        makeCtx({
            ticketType: bagType,
            input: {
                userId: "u1",
                ticketTypeId: "tt_pool_bag",
                sourceRef: "panel:u1:tt_pool_bag:1",
                reason: "Cortesia",
                membershipStartDate: null,
                membershipSchedule: null,
                // Cuerpo armado a mano: sin el descarte, esto reservaba el cupo
                // de dos dias que buildEntitlementDates no iba a materializar.
                scheduleSelections: [{ date: "2026-09-02" }, { date: "2026-09-03" }],
            },
            dateInventory: [
                { date: "2026-09-02", capacity: 30, sold: 5, isEnabled: true },
                { date: "2026-09-03", capacity: 30, sold: 5, isEnabled: true },
            ],
        })
    )
    assert.equal(result.ok, true)
    if (result.ok) {
        assert.deepEqual(result.plan.scheduleSelections, [])
        assert.deepEqual(result.plan.entitlementDates, [])
        assert.equal(result.plan.entitlementMode, "POOL_BAG")
    }
})

test("un tipo que exige turno se rechaza: el panel no captura turno (I-7)", () => {
    // Sin turno el ticket queda con expectedShift = null y el escaner se salta
    // esa validacion: el titular entraria a AMBOS turnos con un solo cupo del
    // dia. Se rechaza hasta que exista un selector de turno.
    const turnoType: CarnetValidationContext["ticketType"] = {
        ...baseTicketType,
        id: "tt_turnos",
        name: "ENTRADA CON TURNO",
        monthlyClassLimit: null,
        membershipDurationMonths: null,
        membershipScheduleKey: null,
        capacityByDate: true,
        validDays: {
            dates: ["2026-09-02"],
            shifts: ["Manana (09:00-12:00)", "Tarde (14:00-17:00)"],
        },
        event: { ...baseTicketType.event, category: "EVENTO" },
    }
    const turnoInput = {
        userId: "u1",
        ticketTypeId: "tt_turnos",
        sourceRef: "panel:u1:tt_turnos:1",
        reason: "Cortesia",
        membershipStartDate: null,
        membershipSchedule: null,
        scheduleSelections: [{ date: "2026-09-02" }],
    }
    const dateInventory = [{ date: "2026-09-02", capacity: 50, sold: 1, isEnabled: true }]

    const result = validateCarnetRequest(
        makeCtx({ ticketType: turnoType, input: turnoInput, dateInventory })
    )
    assert.equal(result.ok, false)
    assert.match(errorsOf(result).join(" "), /turno/i)

    // Con requireShiftSelection = false (turnos informativos) si se puede emitir.
    const opcional = validateCarnetRequest(
        makeCtx({
            ticketType: {
                ...turnoType,
                validDays: {
                    dates: ["2026-09-02"],
                    shifts: ["Manana (09:00-12:00)"],
                    requireShiftSelection: false,
                },
            },
            input: turnoInput,
            dateInventory,
        })
    )
    assert.equal(opcional.ok, true)
})

test("el duplicado trae un codigo estable, no solo un mensaje (I-8)", () => {
    // El script de import separa "saltar fila ya emitida" de "abortar el lote"
    // con este codigo. Antes lo hacia con /ya se emiti/ contra el texto: basta
    // reescribir el mensaje para que un lote a medio emitir no se pueda
    // reintentar nunca mas desde el mismo archivo.
    const result = validateCarnetRequest(
        makeCtx({ duplicateOrderId: "ord_1", input: { reason: "  " } })
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    const duplicado = result.issues.find((issue) => issue.code === "ALREADY_ISSUED")
    assert.ok(duplicado, "falta el issue con code ALREADY_ISSUED")
    assert.match(duplicado.message, /ya se emiti/i)
    // Y es el mensaje del duplicado, no el primero de la lista: aca el primero
    // es el del motivo faltante, que es justo lo que el script imprimia.
    assert.notEqual(result.errors[0], duplicado.message)
    assert.equal(result.errors.length, result.issues.length)
})

test("los datos de facturacion y la marca de origen llegan al plan (I-3)", () => {
    // Defaults del panel: origen admin-carnet-panel, BOLETA, documento y
    // nombre del titular, sin telefono.
    const porDefecto = validateCarnetRequest(makeCtx())
    assert.equal(porDefecto.ok, true)
    if (porDefecto.ok) {
        assert.equal(porDefecto.plan.source, "admin-carnet-panel")
        assert.equal(porDefecto.plan.documentType, "BOLETA")
        assert.equal(porDefecto.plan.buyerDocType, "1")
        assert.equal(porDefecto.plan.buyerDocNumber, "12345678")
        assert.equal(porDefecto.plan.buyerName, "Ana Torres")
        assert.equal(porDefecto.plan.buyerPhone, null)
        assert.deepEqual(porDefecto.plan.auditExtra, {})
    }

    // Import por CSV: marca propia (para no ensuciar el historial del panel),
    // comprador distinto del asistente y RUC de 11 digitos => buyerDocType 6.
    const importado = validateCarnetRequest(
        makeCtx({
            input: {
                source: "presential-carnet-import",
                buyerName: "ACADEMIA SAC",
                buyerPhone: "999888777",
                buyerDocNumber: "20123456789",
                documentType: "FACTURA",
                extra: { batch: "videna-ago-2026", rowNumber: 7 },
            },
        })
    )
    assert.equal(importado.ok, true)
    if (importado.ok) {
        assert.equal(importado.plan.source, "presential-carnet-import")
        assert.equal(importado.plan.documentType, "FACTURA")
        assert.equal(importado.plan.buyerDocType, "6")
        assert.equal(importado.plan.buyerDocNumber, "20123456789")
        assert.equal(importado.plan.buyerName, "ACADEMIA SAC")
        assert.equal(importado.plan.buyerPhone, "999888777")
        assert.deepEqual(importado.plan.auditExtra, { batch: "videna-ago-2026", rowNumber: 7 })
    }
})
