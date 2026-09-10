import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import crypto from "node:crypto"

import type { QRTokenRecord, QRTokenStore } from "@/lib/qr-token"

const loadTestModule = createRequire(__filename)

// No production secrets or database connections are used by these tests.
process.env.QR_SECRET = "short-qr-test-secret-only"
const { createQRPayload, generateSignature, parseQRPayload, verifySignature } =
    loadTestModule("@/lib/qr") as typeof import("@/lib/qr")
const { issueQRToken, resolveQRToken } =
    loadTestModule("@/lib/qr-token") as typeof import("@/lib/qr-token")
const { parseScannedPayload } =
    loadTestModule("@/lib/scan-payload") as typeof import("@/lib/scan-payload")
const { BarcodeWedgeBuffer } =
    loadTestModule("@/hooks/useBarcodeWedge") as typeof import("@/hooks/useBarcodeWedge")

function memoryStore() {
    const rows = new Map<string, QRTokenRecord>()
    const store: QRTokenStore = {
        async save(row) { rows.set(row.tokenHash, { ...row }) },
        async find(hash) { return rows.get(hash) ?? null },
    }
    return { store, rows }
}
function payload() {
    return createQRPayload("ticket-1", "event-1", "user-1", "K7MW-4XQD-9RTB", new Date(2026, 8, 10, 12), "MANANA")
}

test("short QR is opaque, 43 alphanumeric characters and resolves the complete signed context", async () => {
    const { store, rows } = memoryStore()
    const original = payload()
    const token = await issueQRToken(original, store)
    assert.match(token, /^FQ1[0-9A-F]{40}$/)
    assert.equal(token.length, 43)
    assert.ok(token.length < JSON.stringify(original).length * 0.2)
    assert.deepEqual(await resolveQRToken(token, store), original)
    assert.deepEqual(await resolveQRToken(" " + token.toLowerCase() + "\r\n", store), original)
    const stored = [...rows.values()][0]
    assert.equal(stored.tokenHash, crypto.createHash("sha256").update(token).digest("hex"))
    assert.ok(!JSON.stringify(stored).includes(token))
})

test("refreshes reuse one token despite new nonces; date and shift get separate references", async () => {
    const { store, rows } = memoryStore()
    const original = payload()
    const token = await issueQRToken(original, store)
    const refreshed = payload()
    assert.notEqual(original.nonce, refreshed.nonce)
    assert.equal(await issueQRToken(refreshed, store), token)
    assert.equal(rows.size, 1)
    for (const change of [
        { date: "2026-09-11" }, { shift: "TARDE" }, { ticketId: "ticket-2" },
        { eventId: "event-2" }, { userId: "user-2" }, { ticketCode: "ABCD-EFGH-JKLM" },
    ]) {
        const changed = { ...original, ...change }
        changed.signature = generateSignature(changed)
        assert.notEqual(await issueQRToken(changed, store), token)
    }
    assert.deepEqual(await resolveQRToken(token, store), refreshed)
})

test("invalid signatures cannot be issued; unknown, altered and truncated tokens cannot resolve", async () => {
    const { store, rows } = memoryStore()
    await assert.rejects(issueQRToken({ ...payload(), signature: "0".repeat(64) }, store))
    assert.equal(rows.size, 0)
    const token = await issueQRToken(payload(), store)
    for (let i = 3; i < token.length; i++) {
        assert.equal(await resolveQRToken(token.slice(0, i), store), null)
        const altered = token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1)
        assert.equal(await resolveQRToken(altered, store), null)
    }
    assert.equal(await resolveQRToken(token + "A", store), null)
    assert.equal(await resolveQRToken("FQ1" + "0".repeat(40), store), null)
})

test("a corrupted or misassociated stored context is rejected", async () => {
    const { store, rows } = memoryStore()
    const original = payload()
    const token = await issueQRToken(original, store)
    const hash = [...rows.keys()][0]
    const record = rows.get(hash)!
    for (const bad of [
        { ...record, payload: "not JSON" },
        { ...record, payload: JSON.stringify({ ...original, signature: 123 }) },
        { ...record, payload: JSON.stringify({ ...original, shift: {} }) },
        { ...record, ticketId: "wrong-ticket" },
        { ...record, payload: JSON.stringify({ ...original, date: "2026-09-11" }) },
    ]) {
        rows.set(hash, bad)
        assert.equal(await resolveQRToken(token, store), null)
    }
    const other = { ...original, date: "2026-09-11" }
    other.signature = generateSignature(other)
    rows.set(hash, { ...record, payload: JSON.stringify(other) })
    assert.equal(await resolveQRToken(token, store), null, "even a valid signature must match this token")
})

test("tokens fail closed if persistence fails or the secret is missing", async () => {
    const original = payload()
    await assert.rejects(issueQRToken(original, {
        async save() { throw new Error("database unavailable") },
        async find() { return null },
    }), /database unavailable/)
    const secret = process.env.QR_SECRET
    try {
        delete process.env.QR_SECRET
        await assert.rejects(issueQRToken(original, memoryStore().store), /QR_SECRET/)
        process.env.QR_SECRET = "default-secret-change-me"
        await assert.rejects(issueQRToken(original, memoryStore().store), /QR_SECRET/)
    } finally {
        process.env.QR_SECRET = secret
    }
})

test("tokens and legacy QR use signed validation, fragments never become manual codes", async () => {
    const original = payload()
    const token = await issueQRToken(original, memoryStore().store)
    const parsed = parseScannedPayload(token.toLowerCase())
    assert.equal(parsed?.kind, "signed-qr")
    assert.equal(parsed?.kind === "signed-qr" ? parsed.qrData : null, token)
    assert.equal(parseScannedPayload(JSON.stringify(original))?.kind, "signed-qr")
    for (let cut = 1; cut < token.length; cut++) {
        assert.equal(parseScannedPayload(token.slice(0, cut)), null)
    }
    assert.equal(parseScannedPayload(token + "K7MW-4XQD-9RTB"), null)
    assert.equal(parseScannedPayload("K7MW-4XQD-9RTB")?.kind, "lookup")
})

test("legacy v1 and v2 printed QR signatures still verify", () => {
    const original = payload()
    assert.ok(verifySignature(parseQRPayload(JSON.stringify(original))!))
    const v1Data = [original.ticketId, original.eventId, original.userId, original.date, original.ticketCode, original.nonce].join(":")
    const signature = crypto.createHmac("sha256", process.env.QR_SECRET!).update(v1Data).digest("hex")
    assert.ok(verifySignature(parseQRPayload(JSON.stringify({ ...original, signature }))!))
})

test("slow HID transmission survives pauses, emits once on Enter and still supports old QR", async () => {
    const token = await issueQRToken(payload(), memoryStore().store)
    const scans: string[] = []
    let pending: (() => void) | null = null
    const buffer = new BarcodeWedgeBuffer({
        onScan: (raw) => scans.push(raw),
        schedule: (callback) => { pending = callback; return 1 as unknown as ReturnType<typeof setTimeout> },
        cancel: () => { pending = null },
    })
    const tick = () => { const callback = pending; pending = null; callback?.() }
    for (let index = 0; index < token.length - 1; index++) {
        buffer.push(token[index])
        tick()
        assert.deepEqual(scans, [], "even pauses inside the FQ1 prefix must preserve the scan")
    }
    buffer.push(token.slice(-1))
    buffer.push("\r\n")
    tick()
    assert.deepEqual(scans, [token])
    const legacy = JSON.stringify(payload())
    buffer.push(legacy + "\r\n")
    assert.deepEqual(scans, [token, legacy])
    buffer.push(token)
    tick()
    assert.deepEqual(scans, [token, legacy, token], "no-Enter fallback still works")
    buffer.dispose()
})

test("a stalled short QR eventually reports an invalid scan instead of hanging", () => {
    let pending: (() => void) | null = null
    const scans: string[] = []
    const buffer = new BarcodeWedgeBuffer({
        onScan: (raw) => scans.push(raw), maxPartialWaitMs: 400,
        schedule: (callback) => { pending = callback; return 1 as unknown as ReturnType<typeof setTimeout> },
        cancel: () => { pending = null },
    })
    buffer.push("FQ1ABCDEF1234")
    for (let i = 0; i < 3; i++) { const callback = pending as (() => void) | null; pending = null; callback?.() }
    assert.equal(scans.length, 1)
    assert.equal(parseScannedPayload(scans[0]), null)
    buffer.dispose()
})
