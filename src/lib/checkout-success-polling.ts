// Ritmo de consulta de la página /checkout/success mientras la orden sigue
// PENDING. Antes consultaba ~30s y luego dejaba el spinner "Procesando tu
// pago…" girando para siempre, sin volver a preguntar.

/** Fase rápida: el caso normal, la confirmación llega en segundos. */
const FAST_RETRIES = 10
const FAST_INTERVAL_MS = 3_000

/** Fase lenta: la confirmación (IPN / conciliación) se demora; ~5 min más. */
const SLOW_RETRIES = 20
const SLOW_INTERVAL_MS = 15_000

export type CheckoutSuccessPollPhase = "fast" | "slow" | "stopped"

/**
 * `retriesDone` = reintentos ya programados tras la consulta inicial.
 * - "fast": spinner de "unos segundos".
 * - "slow": se sigue consultando, pero la pantalla ya no promete segundos.
 * - "stopped": no se consulta más por cuenta propia; el comprador puede pedirlo.
 */
export function getCheckoutSuccessPollPhase(retriesDone: number): CheckoutSuccessPollPhase {
    if (retriesDone < FAST_RETRIES) {
        return "fast"
    }

    return retriesDone < FAST_RETRIES + SLOW_RETRIES ? "slow" : "stopped"
}

/** Milisegundos hasta la siguiente consulta, o null si ya no toca consultar. */
export function getNextCheckoutSuccessPollDelayMs(retriesDone: number): number | null {
    const phase = getCheckoutSuccessPollPhase(retriesDone)

    if (phase === "fast") {
        return FAST_INTERVAL_MS
    }

    return phase === "slow" ? SLOW_INTERVAL_MS : null
}
