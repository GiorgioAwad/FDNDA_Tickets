"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Minus, Plus, ShoppingBag, Trash2 } from "lucide-react"
import { useMerchCart } from "@/hooks/merch-cart-context"
import { formatPrice } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ZONE_THEME } from "./theme"

export default function MerchCartFloatingButton() {
    const { items, total, itemCount, updateQuantity, removeItem } = useMerchCart()
    const isActive = itemCount > 0
    const [open, setOpen] = useState(false)
    const isPanelOpen = open && isActive
    const wrapperRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!isPanelOpen) return
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (wrapperRef.current && !wrapperRef.current.contains(target)) {
                setOpen(false)
            }
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setOpen(false)
        }
        window.addEventListener("pointerdown", handlePointerDown)
        window.addEventListener("keydown", handleKeyDown)
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown)
            window.removeEventListener("keydown", handleKeyDown)
        }
    }, [isPanelOpen])

    return (
        <div
            ref={wrapperRef}
            className={`fixed bottom-6 left-6 z-[60] transition-all duration-300 ease-out ${
                isActive ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-95 pointer-events-none"
            }`}
        >
            <div
                className={`absolute bottom-full left-0 mb-3 w-[calc(100vw-3rem)] sm:w-96 origin-bottom-left transition-all duration-200 ${
                    isPanelOpen ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 translate-y-2 pointer-events-none"
                }`}
            >
                <div className="rounded-2xl border border-gray-200 bg-white shadow-elevated">
                    <div className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="text-sm font-semibold text-gray-900">Tu carrito de merch</div>
                            <span className="text-xs text-muted-foreground">{itemCount} {itemCount === 1 ? "producto" : "productos"}</span>
                        </div>

                        <div className="space-y-3 max-h-72 overflow-auto pr-1">
                            {items.map((item) => {
                                const theme = ZONE_THEME[item.zone]
                                return (
                                    <div key={item.lineKey} className="flex gap-3 items-start">
                                        <div className={`relative h-14 w-14 rounded-lg overflow-hidden flex-shrink-0 ${theme.bg}`}>
                                            {item.imageUrl ? (
                                                <Image src={item.imageUrl} alt={item.productName} fill sizes="56px" className="object-contain p-1" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-white/40">
                                                    <ShoppingBag className="h-5 w-5" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-gray-900 line-clamp-1">{item.productName}</div>
                                            <div className="text-xs text-muted-foreground">
                                                {item.zone !== "GENERICA" && <span className={theme.accent}>Zona {theme.short}</span>}
                                                {item.size && (
                                                    <>
                                                        {item.zone !== "GENERICA" && <span> · </span>}
                                                        <span>Talla {item.size}</span>
                                                    </>
                                                )}
                                            </div>
                                            <div className="flex items-center justify-between mt-1.5">
                                                <div className="inline-flex items-center rounded-full border border-border overflow-hidden">
                                                    <button
                                                        type="button"
                                                        className="h-7 w-7 inline-flex items-center justify-center hover:bg-gray-50"
                                                        onClick={() => updateQuantity(item.lineKey, item.quantity - 1)}
                                                        aria-label="Disminuir"
                                                    >
                                                        <Minus className="h-3 w-3" />
                                                    </button>
                                                    <span className="px-2 text-xs font-semibold min-w-[1.5rem] text-center">{item.quantity}</span>
                                                    <button
                                                        type="button"
                                                        className="h-7 w-7 inline-flex items-center justify-center hover:bg-gray-50"
                                                        onClick={() => updateQuantity(item.lineKey, item.quantity + 1)}
                                                        aria-label="Aumentar"
                                                    >
                                                        <Plus className="h-3 w-3" />
                                                    </button>
                                                </div>
                                                <div className="text-sm font-semibold text-gray-900">
                                                    {formatPrice(item.price * item.quantity)}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            className="text-muted-foreground hover:text-destructive p-1"
                                            onClick={() => removeItem(item.lineKey)}
                                            aria-label="Quitar"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                )
                            })}
                        </div>

                        <div className="my-3 h-px bg-gray-100" />

                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Subtotal</span>
                            <span className="font-bold text-gray-900 text-base">{formatPrice(total)}</span>
                        </div>

                        <div className="mt-3 flex flex-col gap-2">
                            <Button className="w-full rounded-xl" variant="coral" asChild>
                                <Link href="/checkout/merch">Ir a pagar</Link>
                            </Button>
                            <Button className="w-full rounded-xl" variant="ghost" asChild>
                                <Link href="/merch">Seguir comprando</Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-coral to-coral-strong px-5 py-3 text-sm font-semibold text-white shadow-glow-coral hover:shadow-xl transition-shadow"
                aria-label="Ver carrito de merch"
                aria-expanded={isPanelOpen}
                onClick={() => {
                    if (!isActive) return
                    setOpen((prev) => !prev)
                }}
            >
                <ShoppingBag className="h-4 w-4" />
                <span>Merch</span>
                <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white/25 px-1 text-xs font-bold">
                    {itemCount}
                </span>
            </button>
        </div>
    )
}
