"use client"

import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react"
import { useSession } from "next-auth/react"

export interface CartScheduleConfig {
    dates: string[]
    shifts: string[]
    requiredDays: number | null
    requireShiftSelection: boolean
}

export interface CartScheduleSelection {
    date: string
    shift: string
}

export interface CartAttendee {
    name: string
    dni: string
    scheduleSelections?: CartScheduleSelection[]
}

export interface CartItem {
    ticketTypeId: string
    ticketTypeName: string
    eventId: string
    eventTitle: string
    price: number
    quantity: number
    attendees: CartAttendee[]
    scheduleConfig?: CartScheduleConfig
}

export interface BillingData {
    documentType: "BOLETA" | "FACTURA"
    buyerDocNumber: string
    buyerName: string
    buyerAddress: string
}

interface CartContextType {
    items: CartItem[]
    addItem: (item: Omit<CartItem, "attendees">) => void
    removeItem: (ticketTypeId: string) => void
    updateQuantity: (ticketTypeId: string, quantity: number) => void
    updateAttendee: (ticketTypeId: string, index: number, field: "name" | "dni", value: string) => void
    updateAttendeeScheduleSelection: (
        ticketTypeId: string,
        attendeeIndex: number,
        selectionIndex: number,
        field: "date" | "shift",
        value: string
    ) => void
    billingData: BillingData
    updateBillingData: (field: keyof BillingData, value: string) => void
    clearCart: () => void
    total: number
    itemCount: number
}

const CartContext = createContext<CartContextType | undefined>(undefined)

const DEFAULT_BILLING_DATA: BillingData = {
    documentType: "BOLETA",
    buyerDocNumber: "",
    buyerName: "",
    buyerAddress: "",
}

const LEGACY_CART_KEY = "fdnda-cart"
type CartListener = () => void
const cartListeners = new Set<CartListener>()

const emitCartChange = () => {
    cartListeners.forEach((listener) => listener())
}

const getServerSnapshot = () => "[]"

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

const normalizeDates = (values: unknown): string[] => {
    if (!Array.isArray(values)) return []
    const normalized = values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => DATE_REGEX.test(value))
    return Array.from(new Set(normalized))
}

const normalizeShifts = (values: unknown): string[] => {
    if (!Array.isArray(values)) return []
    const normalized = values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    return Array.from(new Set(normalized))
}

const normalizeScheduleConfig = (input: unknown): CartScheduleConfig | undefined => {
    if (!input || typeof input !== "object") return undefined

    const record = input as Record<string, unknown>
    const requiredDaysRaw = record.requiredDays
    const requiredDaysNum =
        typeof requiredDaysRaw === "number"
            ? requiredDaysRaw
            : typeof requiredDaysRaw === "string"
              ? Number(requiredDaysRaw)
              : NaN
    const requiredDays =
        Number.isFinite(requiredDaysNum) && requiredDaysNum > 0 ? Math.floor(requiredDaysNum) : null

    const dates = normalizeDates(record.dates)
    const shifts = normalizeShifts(record.shifts)
    const requireShiftSelectionRaw = record.requireShiftSelection
    const shiftOptionalRaw = record.shiftOptional
    const requireShiftSelection =
        shifts.length === 0
            ? false
            : typeof requireShiftSelectionRaw === "boolean"
              ? requireShiftSelectionRaw
              : typeof shiftOptionalRaw === "boolean"
                ? !shiftOptionalRaw
                : true

    if (dates.length === 0 && shifts.length === 0 && requiredDays === null) {
        return undefined
    }

    return {
        dates,
        shifts,
        requiredDays,
        requireShiftSelection,
    }
}

const getRequiredScheduleSelections = (scheduleConfig?: CartScheduleConfig): number => {
    if (!scheduleConfig) return 0
    if (typeof scheduleConfig.requiredDays === "number" && scheduleConfig.requiredDays > 0) {
        return scheduleConfig.requiredDays
    }
    return scheduleConfig.dates.length > 0 ? 1 : 0
}

const createEmptySelections = (count: number): CartScheduleSelection[] =>
    Array.from({ length: count }, () => ({ date: "", shift: "" }))

const normalizeScheduleSelections = (
    input: unknown,
    scheduleConfig?: CartScheduleConfig
): CartScheduleSelection[] => {
    const required = getRequiredScheduleSelections(scheduleConfig)
    const rawSelections = Array.isArray(input) ? input : []
    const selections = rawSelections
        .map((entry) => {
            if (!entry || typeof entry !== "object") return { date: "", shift: "" }
            const record = entry as Record<string, unknown>
            return {
                date: typeof record.date === "string" ? record.date.trim() : "",
                shift: typeof record.shift === "string" ? record.shift.trim() : "",
            }
        })
        .slice(0, Math.max(required, rawSelections.length))

    while (selections.length < required) {
        selections.push({ date: "", shift: "" })
    }

    return selections
}

const createEmptyAttendee = (scheduleConfig?: CartScheduleConfig): CartAttendee => {
    const requiredSelections = getRequiredScheduleSelections(scheduleConfig)
    return {
        name: "",
        dni: "",
        scheduleSelections: requiredSelections > 0 ? createEmptySelections(requiredSelections) : [],
    }
}

const normalizeAttendee = (input: unknown, scheduleConfig?: CartScheduleConfig): CartAttendee => {
    const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {}

    return {
        name: typeof record.name === "string" ? record.name : "",
        dni: typeof record.dni === "string" ? record.dni : "",
        scheduleSelections: normalizeScheduleSelections(record.scheduleSelections, scheduleConfig),
    }
}

const normalizeCartItem = (input: unknown): CartItem | null => {
    if (!input || typeof input !== "object") return null

    const record = input as Record<string, unknown>
    const ticketTypeId = typeof record.ticketTypeId === "string" ? record.ticketTypeId : ""
    if (!ticketTypeId) return null

    const quantityRaw =
        typeof record.quantity === "number"
            ? record.quantity
            : typeof record.quantity === "string"
              ? Number(record.quantity)
              : 1
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.floor(quantityRaw) : 1
    const scheduleConfig = normalizeScheduleConfig(record.scheduleConfig)

    const rawAttendees = Array.isArray(record.attendees) ? record.attendees : []
    const attendees = rawAttendees
        .slice(0, quantity)
        .map((attendee) => normalizeAttendee(attendee, scheduleConfig))

    while (attendees.length < quantity) {
        attendees.push(createEmptyAttendee(scheduleConfig))
    }

    const priceRaw =
        typeof record.price === "number"
            ? record.price
            : typeof record.price === "string"
              ? Number(record.price)
              : 0

    return {
        ticketTypeId,
        ticketTypeName: typeof record.ticketTypeName === "string" ? record.ticketTypeName : "",
        eventId: typeof record.eventId === "string" ? record.eventId : "",
        eventTitle: typeof record.eventTitle === "string" ? record.eventTitle : "",
        price: Number.isFinite(priceRaw) ? priceRaw : 0,
        quantity,
        attendees,
        scheduleConfig,
    }
}

const parseCartItems = (value: string): CartItem[] => {
    try {
        const parsed = JSON.parse(value) as unknown
        if (!Array.isArray(parsed)) return []
        return parsed
            .map((item) => normalizeCartItem(item))
            .filter((item): item is CartItem => Boolean(item))
    } catch {
        return []
    }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
    const { data: session, status } = useSession()
    const userKey = session?.user?.id || session?.user?.email || null
    const cartKey = userKey ? `fdnda-cart:${userKey}` : null

    const getSnapshot = useCallback(() => {
        if (typeof window === "undefined") return "[]"
        if (!cartKey) return "[]"
        return window.localStorage.getItem(cartKey) ?? "[]"
    }, [cartKey])

    const subscribe = useCallback((listener: CartListener) => {
        cartListeners.add(listener)

        if (typeof window !== "undefined") {
            const handler = (event: StorageEvent) => {
                if (event.key === cartKey) {
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
    }, [cartKey])

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
                const scheduleConfig = existing.scheduleConfig ?? newItem.scheduleConfig
                const newQuantity = existing.quantity + newItem.quantity
                const attendees = [...existing.attendees]
                if (newQuantity > attendees.length) {
                    for (let i = attendees.length; i < newQuantity; i++) {
                        attendees.push(createEmptyAttendee(scheduleConfig))
                    }
                } else if (newQuantity < attendees.length) {
                    attendees.length = newQuantity
                }

                return current.map((i) =>
                    i.ticketTypeId === newItem.ticketTypeId
                        ? { ...i, quantity: newQuantity, attendees, scheduleConfig }
                        : i
                )
            }

            const attendees = Array.from(
                { length: newItem.quantity },
                () => createEmptyAttendee(newItem.scheduleConfig)
            )
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
                            attendees.push(createEmptyAttendee(item.scheduleConfig))
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

    const updateAttendeeScheduleSelection = (
        ticketTypeId: string,
        attendeeIndex: number,
        selectionIndex: number,
        field: "date" | "shift",
        value: string
    ) => {
        updateItems((current) =>
            current.map((item) => {
                if (item.ticketTypeId !== ticketTypeId) return item

                const attendees = [...item.attendees]
                const attendee = attendees[attendeeIndex]
                if (!attendee) return item

                const selectionCount = Math.max(
                    getRequiredScheduleSelections(item.scheduleConfig),
                    selectionIndex + 1
                )
                const scheduleSelections = [
                    ...(attendee.scheduleSelections ?? createEmptySelections(selectionCount)),
                ]
                while (scheduleSelections.length < selectionCount) {
                    scheduleSelections.push({ date: "", shift: "" })
                }

                const target = scheduleSelections[selectionIndex] ?? { date: "", shift: "" }
                scheduleSelections[selectionIndex] = {
                    ...target,
                    [field]: value,
                }

                attendees[attendeeIndex] = {
                    ...attendee,
                    scheduleSelections,
                }
                return {
                    ...item,
                    attendees,
                }
            })
        )
    }

    const billingKey = cartKey ? `${cartKey}:billing` : null

    const getBillingSnapshot = useCallback(() => {
        if (typeof window === "undefined") return JSON.stringify(DEFAULT_BILLING_DATA)
        if (!billingKey) return JSON.stringify(DEFAULT_BILLING_DATA)
        return window.localStorage.getItem(billingKey) ?? JSON.stringify(DEFAULT_BILLING_DATA)
    }, [billingKey])

    const rawBilling = useSyncExternalStore(subscribe, getBillingSnapshot, () => JSON.stringify(DEFAULT_BILLING_DATA))
    const billingData = useMemo<BillingData>(() => {
        try {
            const parsed = JSON.parse(rawBilling)
            return {
                documentType: parsed.documentType === "FACTURA" ? "FACTURA" : "BOLETA",
                buyerDocNumber: typeof parsed.buyerDocNumber === "string" ? parsed.buyerDocNumber : "",
                buyerName: typeof parsed.buyerName === "string" ? parsed.buyerName : "",
                buyerAddress: typeof parsed.buyerAddress === "string" ? parsed.buyerAddress : "",
            }
        } catch {
            return DEFAULT_BILLING_DATA
        }
    }, [rawBilling])

    const updateBillingData = (field: keyof BillingData, value: string) => {
        if (typeof window === "undefined") return
        if (!billingKey) return
        const current = JSON.parse(window.localStorage.getItem(billingKey) ?? JSON.stringify(DEFAULT_BILLING_DATA))
        const updated = { ...current, [field]: value }
        // Reset doc number and address when switching document type
        if (field === "documentType") {
            updated.buyerDocNumber = ""
            updated.buyerAddress = ""
        }
        window.localStorage.setItem(billingKey, JSON.stringify(updated))
        emitCartChange()
    }

    const clearCart = () => {
        if (typeof window === "undefined") return
        if (!cartKey) return
        window.localStorage.setItem(cartKey, "[]")
        if (billingKey) {
            window.localStorage.removeItem(billingKey)
        }
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
                updateAttendeeScheduleSelection,
                billingData,
                updateBillingData,
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
            updateAttendeeScheduleSelection: () => {},
            billingData: DEFAULT_BILLING_DATA,
            updateBillingData: () => {},
            clearCart: () => {},
            total: 0,
            itemCount: 0,
        }
    }
    return context
}
