import assert from "node:assert/strict"
import test from "node:test"

import { looksLikeSignedQrAttempt, parseScannedPayload } from "@/lib/scan-payload"

const SIGNED_QR = JSON.stringify({
    ticketId: "cmf0xta2b3c4d5e6f7g8h9ijk",
    eventId: "cme9zty7x6w5v4u3t2s7r0q9p",
    userId: "cmd7ab2b3c4d5e6f7g8h9i2jk",
    date: "2026-09-08",
    ticketCode: "K7MW-4XQD-9RTB",
    shift: "MANANA",
    nonce: "a1b2c3d4e5f6a7b8",
    signature: "a".repeat(64),
})

test("a complete signed QR still goes through the HMAC-verified path", () => {
    const parsed = parseScannedPayload(SIGNED_QR)

    assert.equal(parsed?.kind, "signed-qr")
})

test("a short ticket code still goes through the lookup path", () => {
    const parsed = parseScannedPayload("K7MW-4XQD-9RTB")

    assert.equal(parsed?.kind, "lookup")
    assert.equal(parsed?.kind === "lookup" ? parsed.ticketCode : null, "K7MW-4XQD-9RTB")
})

test("a truncated signed QR is rejected instead of downgraded to lookup", () => {
    // El lector HID partia la transmision y el pedazo entraba por
    // `/api/scans/lookup`, que NO verifica la firma: la asistencia quedaba
    // registrada con media lectura.
    for (const cut of [120, 150, 180, 200, 240, 270, SIGNED_QR.length - 1]) {
        const truncated = SIGNED_QR.slice(0, cut)

        assert.equal(
            parseScannedPayload(truncated),
            null,
            `un corte en ${cut} chars no puede caer en el camino sin firma`
        )
    }
})

test("a truncated signed QR never invents a ticket code from the ticketId", () => {
    // En cortes tempranos el buscador compacto agarraba 12 caracteres del cuid y
    // fabricaba un codigo valido de OTRA persona.
    const early = parseScannedPayload(SIGNED_QR.slice(0, 120))

    assert.equal(early, null)
})

test("looksLikeSignedQrAttempt recognises partial payloads, not short codes", () => {
    assert.equal(looksLikeSignedQrAttempt(SIGNED_QR.slice(0, 90)), true)
    assert.equal(looksLikeSignedQrAttempt('"ticketId":"cmf0xta2b3c4d5e6f7g8h9ijk"'), true)
    assert.equal(looksLikeSignedQrAttempt("K7MW-4XQD-9RTB"), false)
    assert.equal(looksLikeSignedQrAttempt("cmf0xta2b3c4d5e6f7g8h9ijk"), false)
})

test("the brace-repair path for a whole payload keeps working", () => {
    // `getScannedJsonCandidates` repara la llave inicial que algunos layouts se
    // comen. Eso es una lectura COMPLETA y debe seguir validando con firma.
    const missingOpeningBrace = SIGNED_QR.slice(1)

    assert.equal(parseScannedPayload(missingOpeningBrace)?.kind, "signed-qr")
})
