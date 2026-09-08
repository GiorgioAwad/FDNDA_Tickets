import assert from "node:assert/strict"
import test from "node:test"

import { BarcodeWedgeBuffer } from "@/hooks/useBarcodeWedge"

const SIGNED_QR = JSON.stringify({
    ticketId: "cmf0xta2b3c4d5e6f7g8h9ijk",
    eventId: "cme9zty7x6w5v4u3t2s7r0q9p",
    userId: "cmd7ab2b3c4d5e6f7g8h9i2jk",
    date: "2026-09-08",
    ticketCode: "K7MW-4XQD-9RTB",
    nonce: "a1b2c3d4e5f6a7b8",
    signature: "a".repeat(64),
})

/** Buffer con reloj manual: `tick()` corre el timeout pendiente. */
function manualBuffer(options: { onScan: (raw: string) => void; maxPartialWaitMs?: number }) {
    const fakeHandle = 1 as unknown as ReturnType<typeof setTimeout>
    let pending: (() => void) | null = null

    const buffer = new BarcodeWedgeBuffer({
        ...options,
        schedule: (callback) => {
            pending = callback
            return fakeHandle
        },
        cancel: () => {
            pending = null
        },
    })

    return {
        buffer,
        tick() {
            const callback = pending
            pending = null
            callback?.()
        },
        get hasPending() {
            return pending !== null
        },
    }
}

test("wedge does not dispatch a signed QR that is still arriving", () => {
    const scans: string[] = []
    const { buffer, tick, hasPending } = manualBuffer({ onScan: (raw) => scans.push(raw) })

    // El DS2278 en "Emulate Keypad" deja pausas a media transmision.
    buffer.push(SIGNED_QR.slice(0, 180))
    tick()

    assert.deepEqual(scans, [], "media lectura no puede salir del buffer")
    assert.equal(hasPending, false, "el reloj manual ya corrio el timeout")

    // Llega el resto y recien ahi se despacha entero.
    buffer.push(SIGNED_QR.slice(180))
    tick()

    assert.deepEqual(scans, [SIGNED_QR])
    buffer.dispose()
})

test("wedge still dispatches a short code on the inactivity timeout", () => {
    const scans: string[] = []
    const { buffer, tick } = manualBuffer({ onScan: (raw) => scans.push(raw) })

    buffer.push("K7MW-4XQD-9RTB")
    tick()

    assert.deepEqual(scans, ["K7MW-4XQD-9RTB"], "un codigo corto no espera")
    buffer.dispose()
})

test("wedge gives up on a stalled partial payload instead of hanging", () => {
    const scans: string[] = []
    const { buffer, tick } = manualBuffer({
        onScan: (raw) => scans.push(raw),
        maxPartialWaitMs: 400, // dos reintentos de 180 ms
    })

    buffer.push(SIGNED_QR.slice(0, 180))
    tick()
    assert.deepEqual(scans, [], "primer reintento")
    tick()
    assert.deepEqual(scans, [], "segundo reintento")

    // Superado el techo, se despacha lo que haya: el parser lo rechazara y el
    // operador repite el pistoletazo, en vez de quedarse colgado sin feedback.
    tick()
    assert.deepEqual(scans, [SIGNED_QR.slice(0, 180)])
    buffer.dispose()
})

test("the Enter suffix still dispatches immediately, without waiting", () => {
    const scans: string[] = []
    const { buffer } = manualBuffer({ onScan: (raw) => scans.push(raw) })

    buffer.push(SIGNED_QR)
    buffer.push("\r\n")

    assert.deepEqual(scans, [SIGNED_QR], "el camino normal del lector no se toca")
    buffer.dispose()
})
