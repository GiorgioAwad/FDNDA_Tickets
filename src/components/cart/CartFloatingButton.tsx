"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ShoppingCart } from "lucide-react"
import { useCart } from "@/hooks/cart-context"
import { useSession } from "next-auth/react"
import { formatPrice } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export default function CartFloatingButton() {
    const { status } = useSession()
    const { items, total, itemCount } = useCart()
    const isActive = itemCount > 0
    const [open, setOpen] = useState(false)
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const closeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
    const hoverRef = useRef(false)

    const clearClose = () => {
        if (closeTimeout.current) {
            clearTimeout(closeTimeout.current)
            closeTimeout.current = null
        }
    }

    const scheduleClose = () => {
        clearClose()
        closeTimeout.current = setTimeout(() => {
            if (!hoverRef.current) {
                setOpen(false)
            }
        }, 200)
    }

    const handleHoverChange = (isHovering: boolean) => {
        hoverRef.current = isHovering
        if (isHovering) {
            clearClose()
            setOpen(true)
        } else {
            scheduleClose()
        }
    }

    useEffect(() => {
        if (!isActive) {
            setOpen(false)
        }
    }, [isActive])

    useEffect(() => {
        if (!open) return

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (wrapperRef.current && !wrapperRef.current.contains(target)) {
                setOpen(false)
            }
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false)
            }
        }

        window.addEventListener("pointerdown", handlePointerDown)
        window.addEventListener("keydown", handleKeyDown)
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown)
            window.removeEventListener("keydown", handleKeyDown)
        }
    }, [open])

    // Don't show cart if not authenticated
    if (status !== "authenticated") {
        return null
    }

    return (
        <div
            ref={wrapperRef}
            className={`fixed bottom-6 right-6 z-[60] transition-all duration-300 ease-out ${
                isActive
                    ? "opacity-100 translate-y-0 scale-100"
                    : "opacity-0 translate-y-2 scale-95 pointer-events-none"
            }`}
        >
            <div
                className={`absolute bottom-full right-0 mb-3 w-80 origin-bottom-right transition-all duration-200 ${
                    open
                        ? "opacity-100 translate-y-0 pointer-events-auto"
                        : "opacity-0 translate-y-2 pointer-events-none"
                }`}
                onPointerEnter={() => handleHoverChange(true)}
                onPointerLeave={() => handleHoverChange(false)}
            >
                <div className="rounded-2xl border border-gray-200 bg-white shadow-xl">
                    <div className="p-4">
                        <div className="text-sm font-semibold text-gray-900">Tu carrito</div>
                        <div className="mt-3 space-y-3 max-h-60 overflow-auto pr-1">
                            {items.map((item) => (
                                <div key={item.ticketTypeId} className="flex gap-3">
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-gray-900 line-clamp-1">
                                            {item.ticketTypeName}
                                        </div>
                                        <div className="text-xs text-gray-500 line-clamp-1">
                                            {item.eventTitle}
                                        </div>
                                        <div className="text-xs text-gray-500 mt-1">
                                            {item.quantity} x {formatPrice(item.price)}
                                        </div>
                                    </div>
                                    <div className="text-sm font-semibold text-gray-900">
                                        {formatPrice(item.price * item.quantity)}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="my-3 h-px bg-gray-100" />

                        <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-500">Total</span>
                            <span className="font-semibold text-gray-900">{formatPrice(total)}</span>
                        </div>

                        <div className="mt-3">
                            <Button className="w-full" asChild>
                                <Link href="/checkout">Ir a pagar</Link>
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            <button
                type="button"
                className="inline-flex items-center gap-2 rounded-full bg-gradient-fdnda px-5 py-3 text-sm font-semibold text-white shadow-lg hover:shadow-xl transition-shadow"
                aria-label="Ver carrito"
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
                onPointerEnter={() => handleHoverChange(true)}
                onPointerLeave={() => handleHoverChange(false)}
            >
                <ShoppingCart className="h-4 w-4" />
                <span>Carrito</span>
                <span className="ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-white/20 px-1 text-xs font-bold">
                    {itemCount}
                </span>
            </button>
        </div>
    )
}
