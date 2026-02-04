import crypto from "crypto"
import QRCode from "qrcode"

const QR_SECRET = process.env.QR_SECRET || "default-secret-change-me"

export interface QRPayload {
    ticketId: string
    eventId: string
    userId: string
    date: string // YYYY-MM-DD
    ticketCode: string
    nonce: string
}

export interface SignedQRPayload extends QRPayload {
    signature: string
}

export function formatDateLocal(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

export function formatDateUTC(date: Date): string {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

/**
 * Generate HMAC signature for QR payload
 */
export function generateSignature(payload: QRPayload): string {
    const data = `${payload.ticketId}:${payload.eventId}:${payload.userId}:${payload.date}:${payload.ticketCode}:${payload.nonce}`
    return crypto.createHmac("sha256", QR_SECRET).update(data).digest("hex")
}

/**
 * Verify HMAC signature of QR payload
 */
export function verifySignature(payload: SignedQRPayload): boolean {
    const expectedSignature = generateSignature(payload)
    return crypto.timingSafeEqual(
        Buffer.from(payload.signature, "hex"),
        Buffer.from(expectedSignature, "hex")
    )
}

/**
 * Generate a signed QR payload for a specific date
 */
export function createQRPayload(
    ticketId: string,
    eventId: string,
    userId: string,
    ticketCode: string,
    date: Date
): SignedQRPayload {
    const nonce = crypto.randomBytes(8).toString("hex")
    const dateStr = formatDateLocal(date)

    const payload: QRPayload = {
        ticketId,
        eventId,
        userId,
        date: dateStr,
        ticketCode,
        nonce,
    }

    return {
        ...payload,
        signature: generateSignature(payload),
    }
}

/**
 * Generate QR code as data URL (base64)
 */
export async function generateQRDataURL(payload: SignedQRPayload): Promise<string> {
    const jsonPayload = JSON.stringify(payload)

    return QRCode.toDataURL(jsonPayload, {
        errorCorrectionLevel: "M",
        type: "image/png",
        width: 400,
        margin: 2,
        color: {
            dark: "#003366", // FDNDA dark blue
            light: "#FFFFFF",
        },
    })
}

/**
 * Generate QR code as SVG string
 */
export async function generateQRSVG(payload: SignedQRPayload): Promise<string> {
    const jsonPayload = JSON.stringify(payload)

    return QRCode.toString(jsonPayload, {
        type: "svg",
        errorCorrectionLevel: "M",
        width: 400,
        margin: 2,
        color: {
            dark: "#003366",
            light: "#FFFFFF",
        },
    })
}

/**
 * Parse and validate a scanned QR code
 */
export function parseQRPayload(qrData: string): SignedQRPayload | null {
    try {
        const payload = JSON.parse(qrData) as SignedQRPayload

        // Validate required fields
        if (
            !payload.ticketId ||
            !payload.eventId ||
            !payload.userId ||
            !payload.date ||
            !payload.ticketCode ||
            !payload.nonce ||
            !payload.signature
        ) {
            return null
        }

        return payload
    } catch {
        return null
    }
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayDateString(): string {
    return formatDateLocal(new Date())
}
