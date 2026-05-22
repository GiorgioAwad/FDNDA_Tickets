"use client"

import React, { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"

export interface MerchCartItem {
    lineKey: string
    productId: string
    variantId: string
    productName: string
    category: "POLERA" | "GORRA" | "PIN" | "OTROS"
    zone: "LIMA" | "SUR" | "NORTE" | "ORIENTE" | "GENERICA"
    size: string | null
    imageUrl: string | null
    price: number
    quantity: number
}

interface MerchCartContextType {
    items: MerchCartItem[]
    addItem: (item: Omit<MerchCartItem, "lineKey">) => void
    removeItem: (lineKey: string) => void
    updateQuantity: (lineKey: string, quantity: number) => void
    clearCart: () => void
    total: number
    itemCount: number
}

const MerchCartContext = createContext<MerchCartContextType | undefined>(undefined)

const GUEST_CART_KEY = "fdnda-merch-cart:guest"
const GUEST_CART_TS_KEY = `${GUEST_CART_KEY}:ts`
const GUEST_CART_TTL_MS = 60 * 60 * 1000

type Listener = () => void
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l())

const buildLineKey = (productId: string, variantId: string): string => `${productId}::${variantId}`

const normalizeCategory = (raw: unknown): MerchCartItem["category"] => {
    if (raw === "POLERA" || raw === "GORRA" || raw === "PIN" || raw === "OTROS") return raw
    return "OTROS"
}

const normalizeZone = (raw: unknown): MerchCartItem["zone"] => {
    if (raw === "LIMA" || raw === "SUR" || raw === "NORTE" || raw === "ORIENTE" || raw === "GENERICA") return raw
    return "GENERICA"
}

const normalizeItem = (input: unknown): MerchCartItem | null => {
    if (!input || typeof input !== "object") return null
    const record = input as Record<string, unknown>
    const productId = typeof record.productId === "string" ? record.productId : ""
    const variantId = typeof record.variantId === "string" ? record.variantId : ""
    if (!productId || !variantId) return null

    const quantityRaw = typeof record.quantity === "number" ? record.quantity : Number(record.quantity)
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 1
    const priceRaw = typeof record.price === "number" ? record.price : Number(record.price)
    const price = Number.isFinite(priceRaw) ? priceRaw : 0

    return {
        lineKey: typeof record.lineKey === "string" && record.lineKey ? record.lineKey : buildLineKey(productId, variantId),
        productId,
        variantId,
        productName: typeof record.productName === "string" ? record.productName : "",
        category: normalizeCategory(record.category),
        zone: normalizeZone(record.zone),
        size: typeof record.size === "string" && record.size ? record.size : null,
        imageUrl: typeof record.imageUrl === "string" && record.imageUrl ? record.imageUrl : null,
        price,
        quantity,
    }
}

const parseItems = (raw: string): MerchCartItem[] => {
    try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed.map(normalizeItem).filter((item): item is MerchCartItem => item !== null)
    } catch {
        return []
    }
}

export function MerchCartProvider({ children }: { children: React.ReactNode }) {
    const { data: session } = useSession()
    const userKey = session?.user?.id || session?.user?.email || null
    const cartKey = userKey ? `fdnda-merch-cart:${userKey}` : GUEST_CART_KEY

    const getSnapshot = useCallback(() => {
        if (typeof window === "undefined") return "[]"
        if (cartKey === GUEST_CART_KEY) {
            const ts = window.localStorage.getItem(GUEST_CART_TS_KEY)
            if (ts && Date.now() - Number(ts) > GUEST_CART_TTL_MS) {
                window.localStorage.removeItem(GUEST_CART_KEY)
                window.localStorage.removeItem(GUEST_CART_TS_KEY)
                return "[]"
            }
        }
        return window.localStorage.getItem(cartKey) ?? "[]"
    }, [cartKey])

    const subscribe = useCallback((listener: Listener) => {
        listeners.add(listener)
        if (typeof window !== "undefined") {
            const handler = (event: StorageEvent) => {
                if (event.key === cartKey) listener()
            }
            window.addEventListener("storage", handler)
            return () => {
                listeners.delete(listener)
                window.removeEventListener("storage", handler)
            }
        }
        return () => {
            listeners.delete(listener)
        }
    }, [cartKey])

    const raw = useSyncExternalStore(subscribe, getSnapshot, () => "[]")
    const items = useMemo(() => parseItems(raw), [raw])

    const updateItems = useCallback(
        (updater: (current: MerchCartItem[]) => MerchCartItem[]) => {
            if (typeof window === "undefined") return
            const current = parseItems(window.localStorage.getItem(cartKey) ?? "[]")
            const next = updater(current)
            window.localStorage.setItem(cartKey, JSON.stringify(next))
            if (cartKey === GUEST_CART_KEY && next.length > 0) {
                window.localStorage.setItem(GUEST_CART_TS_KEY, String(Date.now()))
            }
            emit()
        },
        [cartKey]
    )

    const addItem = useCallback(
        (newItem: Omit<MerchCartItem, "lineKey">) => {
            const lineKey = buildLineKey(newItem.productId, newItem.variantId)
            updateItems((current) => {
                const existing = current.find((i) => i.lineKey === lineKey)
                if (existing) {
                    return current.map((i) =>
                        i.lineKey === lineKey ? { ...i, quantity: i.quantity + newItem.quantity } : i
                    )
                }
                return [...current, { ...newItem, lineKey }]
            })
        },
        [updateItems]
    )

    const removeItem = useCallback(
        (lineKey: string) => {
            updateItems((current) => current.filter((i) => i.lineKey !== lineKey))
        },
        [updateItems]
    )

    const updateQuantity = useCallback(
        (lineKey: string, quantity: number) => {
            if (quantity <= 0) {
                removeItem(lineKey)
                return
            }
            updateItems((current) =>
                current.map((i) => (i.lineKey === lineKey ? { ...i, quantity } : i))
            )
        },
        [updateItems, removeItem]
    )

    const clearCart = useCallback(() => {
        if (typeof window === "undefined") return
        window.localStorage.setItem(cartKey, "[]")
        emit()
    }, [cartKey])

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

    return (
        <MerchCartContext.Provider
            value={{ items, addItem, removeItem, updateQuantity, clearCart, total, itemCount }}
        >
            {children}
        </MerchCartContext.Provider>
    )
}

export function useMerchCart(): MerchCartContextType {
    const context = useContext(MerchCartContext)
    if (context === undefined) {
        return {
            items: [],
            addItem: () => {},
            removeItem: () => {},
            updateQuantity: () => {},
            clearCart: () => {},
            total: 0,
            itemCount: 0,
        }
    }
    return context
}
