import "server-only"

import { USD_TO_PEN_FALLBACK } from "@/lib/commission-rates"

const SUNAT_API_URL = "https://api.apis.net.pe/v2/sunat/tipo-cambio"
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hora
const FETCH_TIMEOUT_MS = 5_000

let cached: { rate: number; fetchedAt: number; source: "live" | "fallback" } | null = null

type SunatExchangeRate = {
    fecha?: string
    compra?: number | string
    venta?: number | string
}

function isPlausibleRate(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10
}

export type ExchangeRateInfo = {
    rate: number
    source: "live" | "fallback"
    fetchedAt: number
}

export async function getUsdToPenRate(): Promise<ExchangeRateInfo> {
    const now = Date.now()
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        return { rate: cached.rate, source: cached.source, fetchedAt: cached.fetchedAt }
    }

    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        const res = await fetch(SUNAT_API_URL, {
            signal: controller.signal,
            next: { revalidate: 3600 },
            headers: { Accept: "application/json" },
        })
        clearTimeout(timeoutId)

        if (!res.ok) throw new Error(`SUNAT API responded ${res.status}`)
        const data = (await res.json()) as SunatExchangeRate
        const venta = Number(data.venta)
        const compra = Number(data.compra)
        const rate = isPlausibleRate(venta) ? venta : isPlausibleRate(compra) ? compra : NaN

        if (!isPlausibleRate(rate)) throw new Error("SUNAT API returned invalid rate")

        cached = { rate, fetchedAt: now, source: "live" }
        return { rate, source: "live", fetchedAt: now }
    } catch (error) {
        console.warn("[exchange-rate] fallback to constant:", error instanceof Error ? error.message : error)
        if (cached) {
            return { rate: cached.rate, source: cached.source, fetchedAt: cached.fetchedAt }
        }
        cached = { rate: USD_TO_PEN_FALLBACK, fetchedAt: now, source: "fallback" }
        return { rate: USD_TO_PEN_FALLBACK, source: "fallback", fetchedAt: now }
    }
}
