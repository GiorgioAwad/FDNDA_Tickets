import test from "node:test"
import assert from "node:assert/strict"
import {
    isIzipayCheckoutOrigin,
    startIzipayFormWatchdog,
} from "@/lib/izipay-form-watchdog"

type MessageListener = (event: { origin: string }) => void

// Ventana y reloj falsos: el vigilante solo necesita escuchar "message" y
// programar un temporizador, así que no hace falta un navegador.
function createHarness() {
    const listeners = new Set<MessageListener>()
    let scheduled: (() => void) | null = null
    let timeouts = 0

    const watchdog = startIzipayFormWatchdog({
        timeoutMs: 30_000,
        onTimeout: () => {
            timeouts += 1
        },
        target: {
            addEventListener: (_type: "message", listener: MessageListener) => {
                listeners.add(listener)
            },
            removeEventListener: (_type: "message", listener: MessageListener) => {
                listeners.delete(listener)
            },
        },
        setTimer: (callback: () => void) => {
            scheduled = callback
            return 1
        },
        clearTimer: () => {
            scheduled = null
        },
    })

    return {
        watchdog,
        postMessage: (origin: string) => {
            for (const listener of Array.from(listeners)) listener({ origin })
        },
        elapse: () => {
            const callback = scheduled
            scheduled = null
            callback?.()
        },
        isTimerPending: () => scheduled !== null,
        listenerCount: () => listeners.size,
        timeouts: () => timeouts,
    }
}

test("avisa cuando el formulario de Izipay nunca da señales de vida", () => {
    const harness = createHarness()

    harness.elapse()

    assert.equal(harness.timeouts(), 1)
    assert.equal(harness.listenerCount(), 0)
})

test("no avisa si el formulario de Izipay ya respondió", () => {
    const harness = createHarness()

    harness.postMessage("https://checkout.izipay.pe")

    assert.equal(harness.isTimerPending(), false)
    assert.equal(harness.listenerCount(), 0)
    harness.elapse()
    assert.equal(harness.timeouts(), 0)
})

test("ignora mensajes de otros orígenes: no prueban que el formulario cargó", () => {
    const harness = createHarness()

    harness.postMessage("https://ticketingfdnda.pe")
    harness.postMessage("https://evil.example")

    assert.equal(harness.isTimerPending(), true)
    harness.elapse()
    assert.equal(harness.timeouts(), 1)
})

test("stop() cancela el aviso y es seguro llamarlo varias veces", () => {
    const harness = createHarness()

    harness.watchdog.stop()
    harness.watchdog.stop()

    assert.equal(harness.isTimerPending(), false)
    assert.equal(harness.listenerCount(), 0)
    harness.elapse()
    assert.equal(harness.timeouts(), 0)
})

test("reconoce los orígenes del checkout de Izipay, producción y sandbox", () => {
    assert.equal(isIzipayCheckoutOrigin("https://checkout.izipay.pe"), true)
    assert.equal(isIzipayCheckoutOrigin("https://sandbox-checkout.izipay.pe"), true)
})

test("rechaza orígenes que solo se parecen a Izipay", () => {
    assert.equal(isIzipayCheckoutOrigin("https://checkout.izipay.pe.evil.example"), false)
    assert.equal(isIzipayCheckoutOrigin("https://evilizipay.pe"), false)
    assert.equal(isIzipayCheckoutOrigin("http://checkout.izipay.pe"), false)
    assert.equal(isIzipayCheckoutOrigin("null"), false)
    assert.equal(isIzipayCheckoutOrigin(""), false)
})
