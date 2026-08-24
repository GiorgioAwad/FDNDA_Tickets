import test from "node:test"
import assert from "node:assert/strict"
import { isPoolBagTicketType, isPoolSlotTicketType } from "@/lib/pool-bag-classification"

test("pool bags are not classified as sellable time slots", () => {
    const bag = {
        eventCategory: "PISCINA_LIBRE",
        isPackage: true,
        packageDaysCount: 10,
    }

    assert.equal(isPoolBagTicketType(bag), true)
    assert.equal(isPoolSlotTicketType(bag), false)
})

test("single pool tickets are classified as sellable time slots", () => {
    const slot = {
        eventCategory: "PISCINA_LIBRE",
        isPackage: false,
    }

    assert.equal(isPoolSlotTicketType(slot), true)
})
