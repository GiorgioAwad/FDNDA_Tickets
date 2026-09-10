import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import type { QRTokenRecord } from "@/lib/qr-token"
import type { ScanTicket } from "@/lib/scan-helpers"

const loadTestModule = createRequire(__filename)

// Replace external services before loading routes. Tests never connect to a DB.
process.env.QR_SECRET = "qr-flow-test-secret-only"
function stubModule(id: string, exports: unknown) {
    const filename = require.resolve(id)
    require.cache[filename] = { id: filename, filename, loaded: true, exports: { __esModule: true, ...(exports as object) } } as NodeModule
}
const rows = new Map<string, QRTokenRecord>()
let ticket: ScanTicket
let authorized = true
let limited = false
let consumed = 0
let tokenReads = 0
stubModule("@/lib/auth", {
    getCurrentUser: async () => authorized ? { id: "staff-1", role: "STAFF" } : null,
    hasRole: () => true,
})
stubModule("@/lib/rate-limit", { rateLimit: async () => ({ success: !limited }) })
stubModule("@/lib/prisma", { prisma: {
    ticketQRToken: {
        async upsert({ create }: { create: QRTokenRecord }) { rows.set(create.tokenHash, create); return create },
        async findUnique({ where }: { where: { tokenHash: string } }) {
            tokenReads++
            return rows.get(where.tokenHash) ?? null
        },
    },
    ticket: { async findUnique() { return ticket } },
    orderItem: { async findMany() { return [] } },
    scan: { async count() { return consumed }, async create() { return {} } },
    ticketDayEntitlement: {
        async updateMany() {
            if (ticket.entitlements[0].status === "USED") return { count: 0 }
            consumed++
            return { count: 1 }
        },
    },
} })
const { createQRPayload, generateQRDataURL, generateQRSVG, getTodayDateString } =
    loadTestModule("@/lib/qr") as typeof import("@/lib/qr")
const { issueQRToken } = loadTestModule("@/lib/qr-token") as typeof import("@/lib/qr-token")
const { POST } = loadTestModule("@/app/api/scans/validate/route") as typeof import("@/app/api/scans/validate/route")
const { POST: lookup } = loadTestModule("@/app/api/scans/lookup/route") as typeof import("@/app/api/scans/lookup/route")
const { NextRequest } = loadTestModule("next/server") as typeof import("next/server")
const jsQR = loadTestModule("jsqr") as typeof import("jsqr").default
const { PNG } = loadTestModule("pngjs") as { PNG: { sync: { read(buffer: Buffer): { data: Uint8Array; width: number; height: number } } } }

function reset() {
    consumed = 0
    authorized = true
    limited = false
    tokenReads = 0
    const today = getTodayDateString()
    ticket = {
        id: "ticket-1", orderId: "order-1", ticketTypeId: "type-1",
        ticketCode: "K7MW-4XQD-9RTB", eventId: "event-1", status: "ACTIVE",
        attendeeName: "Test Attendee", attendeeDni: null,
        event: { title: "Test Event", startDate: new Date(today), endDate: new Date(today), category: "EVENTO" },
        ticketType: { name: "General", isPackage: false, packageDaysCount: null, validDays: null },
        entitlements: [{ id: "entitlement-1", date: new Date(today + "T12:00:00Z"), status: "AVAILABLE", usedAt: null }],
    }
}
function payload(date = getTodayDateString()) {
    return createQRPayload("ticket-1", "event-1", "user-1", "K7MW-4XQD-9RTB", new Date(date + "T12:00:00"), "MANANA")
}
function request(body: unknown) {
    return new NextRequest("http://localhost/api/scans/validate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
}
async function scan(qrData: string, eventId = "event-1") {
    const response = await POST(request({ qrData, eventId }))
    return { response, body: await response.json() }
}

test("generated PNG decodes to a short token and validates once; duplicate is rejected", async () => {
    reset()
    const original = payload()
    const pngDataUrl = await generateQRDataURL(original)
    const png = PNG.sync.read(Buffer.from(pngDataUrl.split(",")[1], "base64"))
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)
    assert.ok(decoded)
    assert.match(decoded.data, /^FQ1[0-9A-F]{40}$/)
    assert.match(await generateQRSVG(original), /^<svg/)
    assert.equal(rows.size, 1, "PNG and SVG reuse the same stored token")
    const first = await scan(decoded.data)
    assert.equal(first.body.reason, "VALID")
    assert.equal(first.body.ticket.ticketCode, ticket.ticketCode)
    assert.equal(first.body.attendance.used, 1)
    assert.ok(first.response.headers.get("Server-Timing"))
    assert.equal((await scan(decoded.data)).body.reason, "ALREADY_USED")
    assert.equal(consumed, 1)
})

test("legacy JSON still reaches the same successful validation flow", async () => {
    reset()
    assert.equal((await scan(JSON.stringify(payload()))).body.reason, "VALID")
    assert.equal(tokenReads, 0)
})

test("tokens preserve cancellation, event and daily piscina checks", async () => {
    reset()
    const token = await issueQRToken(payload())
    ticket.status = "CANCELLED"
    assert.equal((await scan(token)).body.reason, "CANCELLED")
    ticket.status = "ACTIVE"
    assert.equal((await scan(token, "other-event")).body.reason, "WRONG_EVENT")
    ticket.event.category = "PISCINA_LIBRE"
    const oldToken = await issueQRToken(payload("2020-01-01"))
    assert.equal((await scan(oldToken)).body.reason, "QR_EXPIRED")
    assert.equal(consumed, 0)
})

test("unknown token and partial token cannot consume attendance", async () => {
    reset()
    assert.equal((await scan("FQ1" + "0".repeat(40))).body.reason, "INVALID")
    assert.equal((await scan("FQ1ABCDEF")).body.reason, "INVALID")
    assert.equal(consumed, 0)
})

test("authorization and rate limiting apply to tokens", async () => {
    reset()
    const token = await issueQRToken(payload())
    authorized = false
    assert.equal((await scan(token)).response.status, 401)
    assert.equal(tokenReads, 0)
    authorized = true
    limited = true
    assert.equal((await scan(token)).response.status, 429)
    assert.equal(consumed, 0)
})

test("cached clients cannot send tokens to unsigned manual lookup", async () => {
    reset()
    const token = await issueQRToken(payload())
    const response = await lookup(request({
        rawInput: token, ticketCode: "K7MW-4XQD-9RTB", eventId: "event-1",
    }))
    assert.equal((await response.json()).reason, "INVALID")
    assert.equal(consumed, 0)
})
