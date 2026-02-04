"use client"

import React, { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"

export interface CartItem {
    ticketTypeId: string
    ticketTypeName: string
    eventId: string
    eventTitle: string
    price: number
    quantity: number
    attendees: { name: string; dni: string }[]
}

interface CartContextType {
    items: CartItem[]
    addItem: (item: Omit<CartItem, "attendees">) => void
    removeItem: (ticketTypeId: string) => void
    updateQuantity: (ticketTypeId: string, quantity: number) => void
    updateAttendee: (ticketTypeId: string, index: number, field: "name" | "dni", value: string) => void
    clearCart: () => void
    total: number
    itemCount: number
}

const CartContext = createContext<CartContextType | undefined>(undefined)

const LEGACY_CART_KEY = "fdnda-cart"
type CartListener = () => void
const cartListeners = new Set<CartListener>()

const emitCartChange = () => {
    cartListeners.forEach((listener) => listener())
}

const getServerSnapshot = () => "[]"

const parseCartItems = (value: string): CartItem[] => {
    try {
        const parsed = JSON.parse(value) as CartItem[]
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
    const { data: session, status } = useSession()
    const userKey = session?.user?.id || session?.user?.email || null
    const cartKey = userKey ? `fdnda-cart:${userKey}` : null
    const cartKeyRef = useRef(cartKey)
    cartKeyRef.current = cartKey

    const getSnapshot = () => {
        if (typeof window === "undefined") return "[]"
        if (!cartKeyRef.current) return "[]"
        return window.localStorage.getItem(cartKeyRef.current) ?? "[]"
    }

    const subscribe = (listener: CartListener) => {
        cartListeners.add(listener)

        if (typeof window !== "undefined") {
            const handler = (event: StorageEvent) => {
                if (event.key === cartKeyRef.current) {
                    listener()
                }
            }
            window.addEventListener("storage", handler)
            return () => {
                cartListeners.delete(listener)
                window.removeEventListener("storage", handler)
            }
        }

        return () => {
            cartListeners.delete(listener)
        }
    }

    const rawItems = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
    const items = useMemo(() => parseCartItems(rawItems), [rawItems])

    useEffect(() => {
        if (typeof window === "undefined") return
        if (status === "authenticated") {
            if (window.localStorage.getItem(LEGACY_CART_KEY)) {
                window.localStorage.removeItem(LEGACY_CART_KEY)
            }
        }
    }, [status])

    const updateItems = (updater: (current: CartItem[]) => CartItem[]) => {
        if (typeof window === "undefined") return
        if (!cartKey) return
        const current = parseCartItems(window.localStorage.getItem(cartKey) ?? "[]")
        const next = updater(current)
        window.localStorage.setItem(cartKey, JSON.stringify(next))
        emitCartChange()
    }

    const addItem = (newItem: Omit<CartItem, "attendees">) => {
        updateItems((current) => {
            const existing = current.find((i) => i.ticketTypeId === newItem.ticketTypeId)
            if (existing) {
                const newQuantity = existing.quantity + newItem.quantity
                const attendees = [...existing.attendees]
                if (newQuantity > attendees.length) {
                    for (let i = attendees.length; i < newQuantity; i++) {
                        attendees.push({ name: "", dni: "" })
                    }
                } else if (newQuantity < attendees.length) {
                    attendees.length = newQuantity
                }

                return current.map((i) =>
                    i.ticketTypeId === newItem.ticketTypeId
                        ? { ...i, quantity: newQuantity, attendees }
                        : i
                )
            }

            const attendees = Array.from({ length: newItem.quantity }, () => ({ name: "", dni: "" }))
            return [...current, { ...newItem, attendees }]
        })
    }

    const removeItem = (ticketTypeId: string) => {
        updateItems((current) => current.filter((i) => i.ticketTypeId !== ticketTypeId))
    }

    const updateQuantity = (ticketTypeId: string, quantity: number) => {
        if (quantity <= 0) {
            removeItem(ticketTypeId)
            return
        }

        updateItems((current) =>
            current.map((item) => {
                if (item.ticketTypeId === ticketTypeId) {
                    const attendees = [...item.attendees]
                    if (quantity > attendees.length) {
                        for (let i = attendees.length; i < quantity; i++) {
                            attendees.push({ name: "", dni: "" })
                        }
                    } else if (quantity < attendees.length) {
                        attendees.length = quantity
                    }
                    return { ...item, quantity, attendees }
                }
                return item
            })
        )
    }

    const updateAttendee = (
        ticketTypeId: string,
        index: number,
        field: "name" | "dni",
        value: string
    ) => {
        updateItems((current) =>
            current.map((item) => {
                if (item.ticketTypeId === ticketTypeId) {
                    const newAttendees = [...item.attendees]
                    if (newAttendees[index]) {
                        newAttendees[index] = { ...newAttendees[index], [field]: value }
                    }
                    return { ...item, attendees: newAttendees }
                }
                return item
            })
        )
    }

    const clearCart = () => {
        if (typeof window === "undefined") return
        if (!cartKey) return
        window.localStorage.setItem(cartKey, "[]")
        emitCartChange()
    }

    const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

    return (
        <CartContext.Provider
            value={{
                items,
                addItem,
                removeItem,
                updateQuantity,
                updateAttendee,
                clearCart,
                total,
                itemCount,
            }}
        >
            {children}
        </CartContext.Provider>
    )
}

export function useCart() {
    const context = useContext(CartContext)
    if (context === undefined) {
        return {
            items: [],
            addItem: () => {},
            removeItem: () => {},
            updateQuantity: () => {},
            updateAttendee: () => {},
            clearCart: () => {},
            total: 0,
            itemCount: 0,
        }
    }
    return context
}
