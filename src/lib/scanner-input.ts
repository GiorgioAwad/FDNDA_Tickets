/**
 * Builds conservative JSON candidates from a scanner wedge payload.
 *
 * Some HID keyboard layouts intermittently omit only the first opening brace.
 * Repairing that delimiter is safe here because the signed fields are still
 * required by the client and the server remains responsible for HMAC validation.
 */
export function getScannedJsonCandidates(input: string): string[] {
    const trimmed = input.trim()
    if (!trimmed) return []

    const candidates = new Set<string>([trimmed])

    if (/^"ticketId"\s*:/.test(trimmed) && trimmed.endsWith("}")) {
        candidates.add(`{${trimmed}`)
    }

    const firstBrace = trimmed.indexOf("{")
    const lastBrace = trimmed.lastIndexOf("}")
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.add(trimmed.slice(firstBrace, lastBrace + 1))
    }

    return [...candidates]
}
