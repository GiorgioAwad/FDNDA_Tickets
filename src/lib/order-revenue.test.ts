import assert from "node:assert/strict"
import test from "node:test"
import { allocateAmountsProportionally } from "./order-revenue"

test("keeps the final charged total after a discount", () => {
    assert.deepEqual(allocateAmountsProportionally([20], 10), [10])
})

test("allocates discounts proportionally between ticket types", () => {
    assert.deepEqual(allocateAmountsProportionally([20, 40], 45), [15, 30])
})

test("preserves cents when the proportional result repeats", () => {
    const allocations = allocateAmountsProportionally([10, 10, 10], 10)

    assert.deepEqual(allocations, [3.34, 3.33, 3.33])
    assert.equal(allocations.reduce((sum, amount) => sum + amount, 0), 10)
})

test("returns zero allocations for courtesy items", () => {
    assert.deepEqual(allocateAmountsProportionally([20, 20], 0), [0, 0])
})
