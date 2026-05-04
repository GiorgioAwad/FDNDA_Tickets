import "server-only"

import { USD_TO_PEN_FALLBACK } from "@/lib/commission-rates"

const BCRP_SERIES_VENTA = "PD04640PD"
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hora
const FETCH_TIMEOUT_MS = 6_000

let cached: { rate: number; fetchedAt: number; source: ExchangeRateSource } | null = null

export type ExchangeRateSource = "BCRP" | "SUNAT" | "fallback"

export type ExchangeRateInfo = {
    rate: number
    source: ExchangeRateSource
    fetchedAt: number
}

function isPlausibleRate(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 10
}

function formatBcrpDate(date: Date): string {
    const year = date.getFullYear()
    const month = date.getMonth() + 1
    const day = date.getDate()
    return `${year}-${month}-${day}`
}

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                Accept: "application/json",
                "User-Agent": "fdnda-tickets/1.0",
                ...(options.headers || {}),
            },
            next: { revalidate: 3600 },
        })
    } finally {
        clearTimeout(timeoutId)
    }
}

async function fetchFromBcrp(): Promise<number> {
    const today = new Date()
    const start = new Date(today)
    start.setDate(today.getDate() - 14)
    const url = `https://estadisticas.bcrp.gob.pe/estadisticas/series/api/${BCRP_SERIES_VENTA}/json/${formatBcrpDate(start)}/${formatBcrpDate(today)}`

    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`BCRP responded ${res.status}`)
    const data = (await res.json()) as { periods?: Array<{ values?: unknown[] }> }
    const periods = Array.isArray(data.periods) ? data.periods : []
    if (periods.length === 0) throw new Error("BCRP returned no periods")

    for (let i = periods.length - 1; i >= 0; i--) {
        const values = Array.isArray(periods[i]?.values) ? periods[i].values! : []
        for (const value of values) {
            const rate = Number(value)
            if (isPlausibleRate(rate)) return rate
        }
    }
    throw new Error("BCRP returned no valid rate")
}

async function fetchFromApisNetPe(): Promise<number> {
    const url = "https://api.apis.net.pe/v2/sunat/tipo-cambio"
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`apis.net.pe responded ${res.status}`)
    const data = (await res.json()) as { compra?: number | string; venta?: number | string }
    const venta = Number(data.venta)
    const compra = Number(data.compra)
    if (isPlausibleRate(venta)) return venta
    if (isPlausibleRate(compra)) return compra
    throw new Error("apis.net.pe returned invalid rate")
}

export async function getUsdToPenRate(): Promise<ExchangeRateInfo> {
    const now = Date.now()
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        return { rate: cached.rate, source: cached.source, fetchedAt: cached.fetchedAt }
    }

    const sources: Array<{ name: ExchangeRateSource; fetch: () => Promise<number> }> = [
        { name: "BCRP", fetch: fetchFromBcrp },
        { name: "SUNAT", fetch: fetchFromApisNetPe },
    ]

    for (const { name, fetch: fetchSource } of sources) {
        try {
            const rate = await fetchSource()
            cached = { rate, fetchedAt: now, source: name }
            return { rate, source: name, fetchedAt: now }
        } catch (error) {
            console.warn(
                `[exchange-rate] ${name} failed:`,
                error instanceof Error ? error.message : error
            )
        }
    }

    if (cached) {
        console.warn("[exchange-rate] using stale cached rate")
        return { rate: cached.rate, source: cached.source, fetchedAt: cached.fetchedAt }
    }

    console.warn("[exchange-rate] all sources failed, using hardcoded fallback")
    cached = { rate: USD_TO_PEN_FALLBACK, fetchedAt: now, source: "fallback" }
    return { rate: USD_TO_PEN_FALLBACK, source: "fallback", fetchedAt: now }
}
