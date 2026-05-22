import type { MerchZone, MerchCategory } from "./types"

interface ZoneThemeEntry {
    label: string
    short: string
    badge: string
    bg: string
    accent: string
}

export const ZONE_THEME: Record<MerchZone, ZoneThemeEntry> = {
    LIMA: {
        label: "Lima",
        short: "1 Lima",
        badge: "bg-blue-600 text-white hover:bg-blue-700",
        bg: "bg-gradient-to-br from-blue-100 via-blue-50 to-cyan-50",
        accent: "text-blue-600",
    },
    SUR: {
        label: "Sur",
        short: "2 Sur",
        badge: "bg-pink-600 text-white hover:bg-pink-700",
        bg: "bg-gradient-to-br from-pink-100 via-pink-50 to-rose-50",
        accent: "text-pink-600",
    },
    NORTE: {
        label: "Norte",
        short: "3 Norte",
        badge: "bg-amber-500 text-white hover:bg-amber-600",
        bg: "bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-50",
        accent: "text-amber-600",
    },
    ORIENTE: {
        label: "Oriente",
        short: "4 Oriente",
        badge: "bg-emerald-600 text-white hover:bg-emerald-700",
        bg: "bg-gradient-to-br from-emerald-100 via-green-50 to-teal-50",
        accent: "text-emerald-600",
    },
    GENERICA: {
        label: "General",
        short: "FDNDA",
        badge: "bg-slate-700 text-white hover:bg-slate-800",
        bg: "bg-gradient-to-br from-slate-100 via-white to-slate-50",
        accent: "text-slate-700",
    },
}

export const CATEGORY_LABEL: Record<MerchCategory, string> = {
    POLERA: "Poleras",
    GORRA: "Gorras",
    PIN: "Pines",
    OTROS: "Otros",
}

export const CATEGORY_SINGULAR: Record<MerchCategory, string> = {
    POLERA: "Polera",
    GORRA: "Gorra",
    PIN: "Pin",
    OTROS: "Producto",
}
