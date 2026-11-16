import test from "node:test"
import assert from "node:assert/strict"
import {
    getCheckoutSuccessPollPhase,
    getNextCheckoutSuccessPollDelayMs,
} from "@/lib/checkout-success-polling"

test("los primeros reintentos consultan cada 3 segundos", () => {
    assert.equal(getNextCheckoutSuccessPollDelayMs(0), 3_000)
    assert.equal(getNextCheckoutSuccessPollDelayMs(9), 3_000)
})

test("pasada la fase rápida sigue consultando, pero más espaciado", () => {
    assert.equal(getNextCheckoutSuccessPollDelayMs(10), 15_000)
    assert.equal(getNextCheckoutSuccessPollDelayMs(29), 15_000)
})

test("deja de consultar por su cuenta tras agotar ambas fases", () => {
    assert.equal(getNextCheckoutSuccessPollDelayMs(30), null)
    assert.equal(getNextCheckoutSuccessPollDelayMs(500), null)
})

test("la fase rápida es la única que muestra el spinner de 'unos segundos'", () => {
    assert.equal(getCheckoutSuccessPollPhase(0), "fast")
    assert.equal(getCheckoutSuccessPollPhase(9), "fast")
    assert.equal(getCheckoutSuccessPollPhase(10), "slow")
    assert.equal(getCheckoutSuccessPollPhase(29), "slow")
    assert.equal(getCheckoutSuccessPollPhase(30), "stopped")
})
