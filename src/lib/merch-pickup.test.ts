import assert from "node:assert/strict"
import test from "node:test"
import {
    LEGACY_MERCH_PICKUP,
    formatMerchPickupAddress,
    getMerchPickupSnapshot,
    readMerchPickupSnapshot,
    resolveMerchPickupAssignments,
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

test("resolveMerchPickupAssignments devuelve la unica sede asignada", () => {
    assert.deepEqual(
        resolveMerchPickupAssignments([
            { productId: "p1", pickupLocationId: "sede-1", pickupLocationIsActive: true },
            { productId: "p2", pickupLocationId: "sede-1", pickupLocationIsActive: true },
        ]),
        { kind: "single", pickupLocationId: "sede-1" }
    )
})

test("resolveMerchPickupAssignments detecta sedes mixtas y productos sin recojo", () => {
    assert.deepEqual(
        resolveMerchPickupAssignments([
            { productId: "p1", pickupLocationId: "sede-1", pickupLocationIsActive: true },
            { productId: "p2", pickupLocationId: "sede-2", pickupLocationIsActive: true },
        ]),
        { kind: "mixed", pickupLocationIds: ["sede-1", "sede-2"] }
    )

    assert.deepEqual(
        resolveMerchPickupAssignments([
            { productId: "p3", pickupLocationId: null, pickupLocationIsActive: false },
        ]),
        { kind: "unavailable", productIds: ["p3"] }
    )
})
