function normalizeIzipayMessage(value: string): string {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
}

/**
 * Identifica únicamente cancelaciones iniciadas por el comprador.
 *
 * No basta con que Izipay diga "transacción cancelada": ese texto también
 * puede corresponder a un rechazo del emisor o a un fallo real de la pasarela.
 */
export function isIzipayUserCancellationMessage(value: string | null | undefined): boolean {
    const message = normalizeIzipayMessage(value || "")

    if (!message) {
        return false
    }

    const checkoutWasClosed =
        /\bformulario (?:de compra|de pago)\b.*\bcerrad[oa]\b/.test(message) ||
        /\b(?:payment|checkout) form\b.*\bclosed\b/.test(message)

    const cancelledByUser =
        /\bcancelad[oa]\b.*\b(?:por (?:el |la )?)?(?:usuario|cliente)\b/.test(message) ||
        /\b(?:usuario|cliente)\b.*\bcancel/.test(message) ||
        /\bcancel(?:led|ed)\b.*\bby (?:the )?(?:user|customer)\b/.test(message) ||
        /\b(?:user|customer)\b.*\bcancel/.test(message)

    return checkoutWasClosed || cancelledByUser
}
