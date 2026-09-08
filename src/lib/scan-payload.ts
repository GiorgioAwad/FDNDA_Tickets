/**
 * Interpreta lo que entrega el escaner (camara o lector HID) y decide por que
 * camino se valida: QR firmado (`/api/scans/validate`, con verificacion HMAC) o
 * busqueda por codigo (`/api/scans/lookup`, sin firma).
 *
 * Vive fuera del componente para poder probar esa decision sin un DOM, igual que
 * `BarcodeWedgeBuffer` y `ScanQueue`.
 */
import { getScannedJsonCandidates } from "@/lib/scanner-input"

const TICKET_CODE_REGEX = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){2}$/
const TICKET_CODE_COMPACT_REGEX = /^[A-Z2-9]{12}$/
const TICKET_CODE_GROUP_FINDER_REGEX = /([A-Z2-9]{4}(?:-[A-Z2-9]{4}){2})/i
const TICKET_CODE_COMPACT_FINDER_REGEX = /([A-Z2-9]{12})/i
const CUID_REGEX = /^c[a-z0-9]{24}$/i
const SIGNED_QR_FIELDS = ["ticketId", "eventId", "userId", "date", "ticketCode", "nonce", "signature"] as const

export type ParsedScanPayload =
    | {
          kind: "signed-qr"
          qrData: string
          displayCode: string
      }
    | {
          kind: "lookup"
          ticketCode?: string
          ticketId?: string
          displayCode: string
      }

function normalizeTicketCode(value?: string | null): string | null {
    if (!value) return null
    const upper = value.trim().toUpperCase()
    if (!upper) return null
    if (TICKET_CODE_REGEX.test(upper)) return upper

    const compact = upper.replace(/[^A-Z2-9]/g, "")
    if (!TICKET_CODE_COMPACT_REGEX.test(compact)) return null

    return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}`
}

function extractTicketCodeCandidate(value?: string | null): string | null {
    if (!value) return null
    const direct = normalizeTicketCode(value)
    if (direct) return direct

    const upper = value.toUpperCase()
    const grouped = upper.match(TICKET_CODE_GROUP_FINDER_REGEX)?.[1]
    if (grouped) {
        const normalized = normalizeTicketCode(grouped)
        if (normalized) return normalized
    }

    const compact = upper.match(TICKET_CODE_COMPACT_FINDER_REGEX)?.[1]
    if (compact) {
        const normalized = normalizeTicketCode(compact)
        if (normalized) return normalized
    }

    return null
}

function normalizeTicketId(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    if (!trimmed || !CUID_REGEX.test(trimmed)) return null
    return trimmed
}

function parseJsonObject(input: string): Record<string, unknown> | null {
    const trimmed = input.trim()
    if (!trimmed) return null

    const candidates = getScannedJsonCandidates(trimmed)

    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as unknown
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
            }
        } catch {
            // Ignore invalid JSON candidate
        }
    }

    return null
}

function parseSignedQrPayload(input: string): { qrData: string; displayCode: string } | null {
    const parsed = parseJsonObject(input)
    if (!parsed) return null

    const hasRequiredFields = SIGNED_QR_FIELDS.every((field) => {
        const value = parsed[field]
        return typeof value === "string" && value.trim().length > 0
    })
    if (!hasRequiredFields) return null

    const normalizedTicketCode = normalizeTicketCode(String(parsed.ticketCode)) ?? String(parsed.ticketCode).trim()
    return {
        qrData: JSON.stringify(parsed),
        displayCode: normalizedTicketCode.slice(0, 20),
    }
}

function extractLookupFromUrl(input: string): { ticketCode?: string; ticketId?: string } | null {
    try {
        const url = new URL(input)
        const queryCode =
            extractTicketCodeCandidate(url.searchParams.get("ticketCode")) ??
            extractTicketCodeCandidate(url.searchParams.get("code")) ??
            extractTicketCodeCandidate(url.searchParams.get("ticket"))

        const queryId =
            normalizeTicketId(url.searchParams.get("ticketId")) ??
            normalizeTicketId(url.searchParams.get("id")) ??
            normalizeTicketId(url.searchParams.get("ticket"))

        if (queryCode || queryId) {
            return { ticketCode: queryCode ?? undefined, ticketId: queryId ?? undefined }
        }

        const pathSegments = url.pathname
            .split("/")
            .map((part) => decodeURIComponent(part))
            .filter(Boolean)
        const lastSegment = pathSegments[pathSegments.length - 1]
        const pathCode = extractTicketCodeCandidate(lastSegment)
        const pathId = normalizeTicketId(lastSegment)
        if (pathCode || pathId) {
            return { ticketCode: pathCode ?? undefined, ticketId: pathId ?? undefined }
        }
    } catch {
        // Not a URL
    }

    return null
}

function parseLookupPayload(input: string): ParsedScanPayload | null {
    const ticketCodeFromText = extractTicketCodeCandidate(input)
    const ticketIdFromText = normalizeTicketId(input)
    if (ticketCodeFromText || ticketIdFromText) {
        const displayCode = ticketCodeFromText ?? ticketIdFromText ?? input.slice(0, 20)
        return {
            kind: "lookup",
            ticketCode: ticketCodeFromText ?? undefined,
            ticketId: ticketIdFromText ?? undefined,
            displayCode,
        }
    }

    const fromUrl = extractLookupFromUrl(input)
    if (fromUrl?.ticketCode || fromUrl?.ticketId) {
        return {
            kind: "lookup",
            ticketCode: fromUrl.ticketCode,
            ticketId: fromUrl.ticketId,
            displayCode: fromUrl.ticketCode ?? fromUrl.ticketId ?? input.slice(0, 20),
        }
    }

    const parsedJson = parseJsonObject(input)
    if (parsedJson) {
        const jsonCode =
            extractTicketCodeCandidate(String(parsedJson.ticketCode ?? "")) ??
            extractTicketCodeCandidate(String(parsedJson.code ?? "")) ??
            extractTicketCodeCandidate(String(parsedJson.ticket ?? ""))

        const jsonId =
            normalizeTicketId(parsedJson.ticketId) ??
            normalizeTicketId(parsedJson.id) ??
            normalizeTicketId(parsedJson.ticket)

        if (jsonCode || jsonId) {
            return {
                kind: "lookup",
                ticketCode: jsonCode ?? undefined,
                ticketId: jsonId ?? undefined,
                displayCode: jsonCode ?? jsonId ?? input.slice(0, 20),
            }
        }
    }

    return null
}

/**
 * Reconoce una lectura que INTENTA ser el QR firmado, aunque haya llegado
 * incompleta o deformada. Basta con que arranque como objeto JSON o que asome
 * cualquiera de los campos que solo existen en ese payload.
 */
export function looksLikeSignedQrAttempt(input: string): boolean {
    const trimmed = input.trim()
    if (trimmed.startsWith("{")) return true
    return /"?(ticketId|userId|nonce|signature)"?\s*:/.test(trimmed)
}

export function parseScannedPayload(rawData: string): ParsedScanPayload | null {
    const trimmed = rawData.trim()
    if (!trimmed) return null

    const signedPayload = parseSignedQrPayload(trimmed)
    if (signedPayload) {
        return {
            kind: "signed-qr",
            qrData: signedPayload.qrData,
            displayCode: signedPayload.displayCode,
        }
    }

    // Una lectura que empezo como QR firmado y no completo NO puede degradarse al
    // camino sin firma. `parseLookupPayload` busca un codigo con una expresion
    // regular en cualquier parte del texto, asi que un JSON truncado por el lector
    // HID caia en `/api/scans/lookup` y registraba la asistencia sin verificar el
    // HMAC; peor aun, en cortes tempranos el regex compacto llegaba a inventar un
    // codigo con un pedazo del `ticketId` y consumia la entrada de otra persona.
    // Rechazarla obliga a repetir el pistoletazo, que es lo correcto: la lectura
    // se perdio, la asistencia no se toca.
    if (looksLikeSignedQrAttempt(trimmed)) return null

    return parseLookupPayload(trimmed)
}
