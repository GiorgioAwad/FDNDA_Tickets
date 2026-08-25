import assert from "node:assert/strict"
import test from "node:test"
import {
    calculateDiscountAmount,
    formatLimaDateTimeInput,
    getDiscountEligibleSubtotal,
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
