import assert from "node:assert/strict"
import test from "node:test"
import {
    calculateDiscountAmount,
    discountTicketTypeIdsSchema,
    formatLimaDateTimeInput,
    getDiscountEligibleSubtotal,
    getDiscountTicketTypeIds,
    parseLimaDateTimeInput,
} from "./discounts"

test("interpreta la fecha y hora del administrador en hora Lima", () => {
    const parsed = parseLimaDateTimeInput("2026-08-25T23:30")

    assert.equal(parsed.toISOString(), "2026-08-26T04:30:00.000Z")
    assert.equal(formatLimaDateTimeInput(parsed), "2026-08-25T23:30")
})

test("mantiene válido el código durante todo el minuto seleccionado como hasta", () => {
    const parsed = parseLimaDateTimeInput("2026-08-25T23:30", { endOfMinute: true })

    assert.equal(parsed.toISOString(), "2026-08-26T04:30:59.999Z")
})

test("rechaza fechas civiles inexistentes", () => {
    assert.throws(() => parseLimaDateTimeInput("2026-02-30T10:00"), /inválidas/)
})

test("calcula el subtotal solo para la entrada y el día configurados", () => {
    const subtotal = getDiscountEligibleSubtotal({
        ticketTypeId: "adulto",
        validDate: "2026-09-12",
        items: [
            {
                ticketTypeId: "adulto",
                quantity: 2,
                unitPrice: 50,
                attendees: [
                    { scheduleSelections: [{ date: "2026-09-12", shift: "Mañana" }] },
                    { scheduleSelections: [{ date: "2026-09-13", shift: "Mañana" }] },
                ],
            },
            {
                ticketTypeId: "nino",
                quantity: 1,
                unitPrice: 30,
                attendees: [{ scheduleSelections: [{ date: "2026-09-12" }] }],
            },
        ],
    })

    assert.equal(subtotal, 50)
    assert.equal(calculateDiscountAmount({ eligibleSubtotal: subtotal, type: "PERCENTAGE", value: 20 }), 10)
})

test("limita el descuento fijo al subtotal elegible", () => {
    assert.equal(calculateDiscountAmount({ eligibleSubtotal: 30, type: "FIXED", value: 50 }), 30)
})

test("aplica el descuento a varios horarios sin incluir los demás ni duplicar importes", () => {
    const eligibleSubtotal = getDiscountEligibleSubtotal({
        ticketTypeIds: ["manana", "tarde", "manana"],
        items: [
            { ticketTypeId: "manana", quantity: 2, unitPrice: 50 },
            { ticketTypeId: "tarde", quantity: 1, unitPrice: 40 },
            { ticketTypeId: "noche", quantity: 3, unitPrice: 60 },
        ],
    })

    assert.equal(eligibleSubtotal, 140)
    assert.equal(calculateDiscountAmount({ eligibleSubtotal, type: "PERCENTAGE", value: 20 }), 28)
    assert.equal(calculateDiscountAmount({ eligibleSubtotal, type: "FIXED", value: 200 }), 140)
})

test("combina varios horarios con el día de aplicación por asistente", () => {
    const eligibleSubtotal = getDiscountEligibleSubtotal({
        ticketTypeIds: ["manana", "tarde"],
        validDate: "2026-11-25",
        items: [
            {
                ticketTypeId: "manana", quantity: 2, unitPrice: 50,
                attendees: [
                    { scheduleSelections: [{ date: "2026-11-25" }] },
                    { scheduleSelections: [{ date: "2026-11-26" }] },
                ],
            },
            {
                ticketTypeId: "tarde", quantity: 1, unitPrice: 40,
                attendees: [{ scheduleSelections: [{ date: "2026-11-25" }, { date: "2026-11-26" }] }],
            },
            {
                ticketTypeId: "noche", quantity: 1, unitPrice: 60,
                attendees: [{ scheduleSelections: [{ date: "2026-11-25" }] }],
            },
        ],
    })

    assert.equal(eligibleSubtotal, 90)
})

test("un carrito sin horarios seleccionados no recibe descuento", () => {
    assert.equal(getDiscountEligibleSubtotal({
        ticketTypeIds: ["manana", "tarde"],
        items: [{ ticketTypeId: "noche", quantity: 1, unitPrice: 60 }],
    }), 0)
})

test("una selección vacía permite todos los horarios", () => {
    assert.equal(getDiscountEligibleSubtotal({
        ticketTypeIds: [],
        items: [
            { ticketTypeId: "manana", quantity: 2, unitPrice: 50 },
            { ticketTypeId: "noche", quantity: 1, unitPrice: 60 },
        ],
    }), 160)
})

test("conserva la selección de los códigos existentes y prioriza la selección múltiple", () => {
    assert.deepEqual(getDiscountTicketTypeIds({ ticketTypeId: "manana", ticketTypes: [] }), ["manana"])
    assert.deepEqual(getDiscountTicketTypeIds({ ticketTypeId: "manana", ticketTypes: [
        { ticketTypeId: "tarde" }, { ticketTypeId: "noche" },
    ] }), ["tarde", "noche"])
    assert.deepEqual(getDiscountTicketTypeIds({ ticketTypeId: null, ticketTypes: [] }), [])
})

test("valida los horarios recibidos y elimina selecciones repetidas", () => {
    assert.deepEqual(discountTicketTypeIdsSchema.parse(["manana", "tarde", "manana"]), ["manana", "tarde"])
    for (const invalid of [null, "manana", [""], ["  "], [1], [{}]]) {
        assert.equal(discountTicketTypeIdsSchema.safeParse(invalid).success, false)
    }
})
