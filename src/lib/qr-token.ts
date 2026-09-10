import crypto from "node:crypto"

import { parseQRPayload, verifySignature, type SignedQRPayload } from "@/lib/qr"
import { normalizeQRToken, QR_TOKEN_PREFIX } from "@/lib/qr-token-format"

export interface QRTokenRecord {
    tokenHash: string
    ticketId: string
    payload: string
}

export interface QRTokenStore {
    save(record: QRTokenRecord): Promise<void>
    find(tokenHash: string): Promise<QRTokenRecord | null>
}

function tokenSecret(): string {
    const secret = process.env.QR_SECRET
    if (!secret || secret === "default-secret-change-me") {
        throw new Error("QR_SECRET must be configured to issue short QR tokens")
    }
    return secret
}

function deriveToken(payload: SignedQRPayload): string {
    // Stable for the same ticket/date/shift: refreshing a ticket never creates
    // another row just because createQRPayload generated a fresh nonce.
    const context = JSON.stringify([
        "fdnda:qr-token:v1", payload.ticketId, payload.eventId, payload.userId,
        payload.ticketCode, payload.date, payload.shift?.trim() ?? "",
    ])
    const digest = crypto.createHmac("sha256", tokenSecret()).update(context).digest("hex")
    // 160-bit opaque credential. Uppercase hex avoids keyboard-layout symbols.
    return QR_TOKEN_PREFIX + digest.slice(0, 40).toUpperCase()
}

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex")
}

async function defaultStore(): Promise<QRTokenStore> {
    const { prisma } = await import("@/lib/prisma")
    return {
        async save(record) {
            await prisma.ticketQRToken.upsert({
                where: { tokenHash: record.tokenHash },
                create: record,
                update: { payload: record.payload },
            })
        },
        find: (tokenHash) => prisma.ticketQRToken.findUnique({ where: { tokenHash } }),
    }
}

export async function issueQRToken(payload: SignedQRPayload, store?: QRTokenStore): Promise<string> {
    if (!verifySignature(payload)) throw new Error("Cannot issue a token for an invalid QR signature")
    const token = deriveToken(payload)
    await (store ?? await defaultStore()).save({
        tokenHash: hashToken(token),
        ticketId: payload.ticketId,
        payload: JSON.stringify(payload),
    })
    return token
}

export async function resolveQRToken(input: string, store?: QRTokenStore): Promise<SignedQRPayload | null> {
    const token = normalizeQRToken(input)
    if (!token) return null
    const record = await (store ?? await defaultStore()).find(hashToken(token))
    if (!record) return null
    const payload = parseQRPayload(record.payload)
    if (!payload || payload.ticketId !== record.ticketId || !verifySignature(payload)) return null
    // Also bind the stored context to this token, even if a row is misassociated.
    if (deriveToken(payload) !== token) return null
    return payload
}
