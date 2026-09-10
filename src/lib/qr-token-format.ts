// Shared with the browser: no crypto, database access or secrets here.
export const QR_TOKEN_PREFIX = "FQ1"
export const QR_TOKEN_LENGTH = 43

export function normalizeQRToken(input: string): string | null {
    const token = input.trim().toUpperCase()
    return /^FQ1[0-9A-F]{40}$/.test(token) ? token : null
}

export function looksLikeQRToken(input: string): boolean {
    return input.trim().toUpperCase().startsWith(QR_TOKEN_PREFIX)
}
