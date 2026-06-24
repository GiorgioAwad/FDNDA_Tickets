"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/utils"
import { Check, Minus, Plus, AlertCircle, Star } from "lucide-react"
import type { PlanBenefit, TicketTypeClient } from "./TicketPurchaseCard"

type AccentTokens = {
    bar: string // gradiente de la franja superior
    ring: string // ring cuando isFeatured
    chip: string // color del texto/acento
}

const ACCENTS: Record<string, AccentTokens> = {
    bronze: { bar: "from-amber-700 to-amber-500", ring: "ring-amber-500", chip: "text-amber-700" },
    silver: { bar: "from-slate-400 to-slate-300", ring: "ring-slate-400", chip: "text-slate-600" },
    gold: { bar: "from-yellow-500 to-amber-400", ring: "ring-yellow-500", chip: "text-yellow-700" },
}

const DEFAULT_ACCENT: AccentTokens = {
    bar: "from-fdnda-primary to-fdnda-secondary",
    ring: "ring-fdnda-secondary",
    chip: "text-fdnda-secondary",
}

const resolveAccent = (accentColor?: string | null): AccentTokens => {
    if (!accentColor) return DEFAULT_ACCENT
    return ACCENTS[accentColor.toLowerCase()] ?? DEFAULT_ACCENT
}

const normalizeBenefits = (value: unknown): PlanBenefit[] => {
    if (!Array.isArray(value)) return []
    const result: PlanBenefit[] = []
    for (const item of value) {
        if (typeof item === "string") {
            const text = item.trim()
            if (text) result.push({ text })
        } else if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
            const obj = item as { text: string; footnote?: unknown }
            const text = obj.text.trim()
            if (text) result.push({ text, footnote: obj.footnote === true })
        }
    }
    return result
}

const computeDiscount = (price: number, originalPrice?: number | null): number | null => {
    if (!originalPrice || originalPrice <= 0 || originalPrice <= price) return null
    return Math.round((1 - price / originalPrice) * 100)
}

type PlanTierCardProps = {
    ticket: TicketTypeClient
    quantity: number
    soldOut: boolean
    saleClosed?: boolean
    maxQty: number
    onIncrement: () => void
    onDecrement: () => void
}

export default function PlanTierCard({
    ticket,
    quantity,
    soldOut,
    saleClosed = false,
    maxQty,
    onIncrement,
    onDecrement,
}: PlanTierCardProps) {
    const accent = resolveAccent(ticket.accentColor)
    const benefits = normalizeBenefits(ticket.benefits)
    const hasFootnotes = benefits.some((benefit) => benefit.footnote)
    const discount = computeDiscount(ticket.price, ticket.originalPrice)
    const featured = Boolean(ticket.isFeatured)

    return (
        <div
            className={`relative flex flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all ${
                featured
                    ? `ring-2 ${accent.ring} shadow-xl lg:-translate-y-1`
                    : "hover:shadow-md"
            } ${soldOut ? "opacity-60" : ""}`}
        >
            {/* Franja superior con acento */}
            <div className={`h-1.5 w-full bg-gradient-to-r ${accent.bar}`} />

            {featured && ticket.highlightLabel && (
                <div className="absolute right-3 top-4">
                    <Badge variant="coral" className="gap-1">
                        <Star className="h-3 w-3 fill-current" />
                        {ticket.highlightLabel}
                    </Badge>
                </div>
            )}

            <div className="flex flex-1 flex-col p-5 sm:p-6">
                {/* Nombre del plan */}
                <h3 className={`font-display text-xl font-bold uppercase tracking-wide ${accent.chip}`}>
                    {ticket.name}
                </h3>
                {ticket.description && (
                    <p className="mt-1 text-sm text-gray-500">{ticket.description}</p>
                )}

                {/* Precio */}
                <div className="mt-4 flex items-end gap-2">
                    <span className="text-3xl font-extrabold text-foreground">{formatPrice(ticket.price)}</span>
                    {ticket.originalPrice && ticket.originalPrice > ticket.price && (
                        <span className="pb-1 text-sm text-gray-400 line-through">
                            {formatPrice(ticket.originalPrice)}
                        </span>
                    )}
                </div>
                {discount !== null && (
                    <Badge variant="success" className="mt-2 w-fit">
                        Ahorra {discount}%
                    </Badge>
                )}
                {ticket.monthlyClassLimit ? (
                    <p className="mt-2 text-xs font-medium text-gray-500">
                        Hasta {ticket.monthlyClassLimit} clases al mes
                    </p>
                ) : null}

                {/* Beneficios */}
                {benefits.length > 0 && (
                    <ul className="mt-5 space-y-2.5 border-t border-dashed border-gray-200 pt-5">
                        {benefits.map((benefit, index) => (
                            <li key={index} className="flex items-start gap-2 text-sm text-foreground/90">
                                <Check className={`mt-0.5 h-4 w-4 flex-shrink-0 ${accent.chip}`} />
                                <span>
                                    {benefit.text}
                                    {benefit.footnote ? <span className="text-gray-400"> *</span> : null}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="flex-1" />

                {/* Acción */}
                <div className="mt-6">
                    {saleClosed ? (
                        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold text-gray-500">
                            <AlertCircle className="h-4 w-4" />
                            Venta cerrada
                        </div>
                    ) : soldOut ? (
                        <div className="flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-600">
                            <AlertCircle className="h-4 w-4" />
                            Agotado
                        </div>
                    ) : quantity === 0 ? (
                        <Button
                            type="button"
                            className="w-full"
                            variant={featured ? "default" : "outline"}
                            size="lg"
                            onClick={onIncrement}
                        >
                            Elegir plan
                        </Button>
                    ) : (
                        <div className="flex items-center justify-between rounded-xl border px-3 py-2">
                            <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                                onClick={onDecrement}
                                aria-label="Quitar"
                            >
                                <Minus className="h-4 w-4" />
                            </button>
                            <span className="text-base font-semibold">{quantity} en carrito</span>
                            <button
                                type="button"
                                className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                onClick={onIncrement}
                                disabled={quantity >= maxQty}
                                aria-label="Agregar"
                            >
                                <Plus className="h-4 w-4" />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {hasFootnotes && (
                <p className="px-5 pb-4 text-[11px] leading-snug text-gray-400 sm:px-6">
                    * Sujeto a términos y condiciones y hasta agotar stock.
                </p>
            )}
        </div>
    )
}
