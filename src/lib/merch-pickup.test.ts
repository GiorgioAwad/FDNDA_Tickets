import assert from "node:assert/strict"
import test from "node:test"
import {
    LEGACY_MERCH_PICKUP,
    formatMerchPickupAddress,
    getMerchPickupSnapshot,
    readMerchPickupSnapshot,
} from "@/lib/merch-pickup"

test("readMerchPickupSnapshot normaliza una sede valida", () => {
    assert.deepEqual(
        readMerchPickupSnapshot({
            id: "sede-1",
            name: "  Videna  ",
            address: " Av. Canada  ",
            district: " San Luis ",
            instructions: " Puerta 2 ",
        }),
        {
            id: "sede-1",
            name: "Videna",
            address: "Av. Canada",
            district: "San Luis",
            instructions: "Puerta 2",
        }
    )
})

test("getMerchPickupSnapshot conserva compatibilidad con pedidos antiguos", () => {
    assert.deepEqual(getMerchPickupSnapshot(null), LEGACY_MERCH_PICKUP)
    assert.deepEqual(getMerchPickupSnapshot({ name: "Incompleta" }), LEGACY_MERCH_PICKUP)
})

test("formatMerchPickupAddress no repite el distrito", () => {
    assert.equal(
        formatMerchPickupAddress({ address: "Av. Canada 30", district: "San Luis" }),
        "Av. Canada 30, San Luis"
    )
    assert.equal(
        formatMerchPickupAddress({ address: "Av. Canada 30, San Luis", district: "San Luis" }),
        "Av. Canada 30, San Luis"
    )
})
