/**
 * Resolución central del modo de pago.
 *
 * `PAYMENTS_MODE=mock` FABRICA una orden PAID sin cobro real y sin número de
 * operación. Ese modo solo existe para desarrollo local. Si por error un
 * despliegue de producción hereda `PAYMENTS_MODE=mock` (p. ej. una build de
 * Vercel apuntando a la BD de producción), NO debe poder emitir entradas ni
 * boletas: el guardado vive en el CÓDIGO, no en el env, porque los `.env*`
 * están gitignored y no viajan por git.
 *
 * Ver incidente 2026-07-03 (fdnda-tickets.vercel.app con PAYMENTS_MODE=mock
 * sobre la BD prod) y el mismo criterio de endurecimiento en email-url.ts.
 */

export function getPaymentsMode(): string {
    return process.env.PAYMENTS_MODE || "mock"
}

/**
 * `true` solo cuando el pago simulado puede ejecutarse de forma segura:
 * modo mock explícito Y entorno NO productivo. Un override explícito
 * (`ALLOW_MOCK_PAYMENTS=true`) permite mock en una build de producción local
 * para pruebas, pero jamás por defecto.
 */
export function isMockPaymentsAllowed(): boolean {
    if (getPaymentsMode() !== "mock") return false
    if (process.env.ALLOW_MOCK_PAYMENTS === "true") return true
    return process.env.NODE_ENV !== "production"
}
