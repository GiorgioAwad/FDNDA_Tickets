"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useCart } from "@/hooks/cart-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getPoolFreeSelectableDates, isPoolFreeEventCategory } from "@/lib/pool-free"
import { formatDate, formatPrice } from "@/lib/utils"
import { parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import { Info, ShoppingCart, Minus, Plus, Gift, CheckCircle, AlertCircle, Ticket, Calendar, Clock, ChevronRight } from "lucide-react"

type DateInventoryClient = {
    date: string | Date
    capacity: number
    sold: number
    isEnabled: boolean
}

export type TicketTypeClient = {
    id: string
    name: string
    description?: string | null
    price: number
    capacity: number
    sold: number
    isActive?: boolean
    isPackage?: boolean | null
    packageDaysCount?: number | null
    validDays?: unknown
    servilexEnabled?: boolean
    servilexIndicator?: string | null
    servilexExtraConfig?: unknown
    dateInventories?: DateInventoryClient[]
}

type TicketPurchaseCardProps = {
    eventId: string
    eventTitle: string
    eventCategory?: string | null
    ticketTypes: TicketTypeClient[]
    eventStartDate?: string | Date
    eventEndDate?: string | Date
}

type PoolSlotOption = {
    key: string
    ticketId: string
    date: string
    label: string
    price: number
    selectable: boolean
    ticketName: string
}

type LimaClock = {
    dateKey: string
    minutes: number
}

const MAX_UNLIMITED_QTY = 10
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"] as const
const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const

const toDateKeyUTC = (value: string | Date): string | null => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    const year = parsed.getUTCFullYear()
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0")
    const day = String(parsed.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const addDaysToDateKey = (value: string, days: number): string => {
    const date = new Date(`${value}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() + days)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const normalizeTimeLabel = (value: string): string => {
    const trimmed = value.trim()
    if (!/^\d{2}:\d{2}$/.test(trimmed)) return trimmed
    const [rawHour, rawMinute] = trimmed.split(":")
    const hour24 = Number(rawHour)
    const minute = Number(rawMinute)
    if (Number.isNaN(hour24) || Number.isNaN(minute)) return trimmed

    const suffix = hour24 >= 12 ? "p. m." : "a. m."
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
    return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`
}

const formatPoolSlotDateLabel = (value: string): string => {
    const parsed = DATE_REGEX.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value)
    if (Number.isNaN(parsed.getTime())) return value

    const weekday = WEEKDAY_LABELS[parsed.getUTCDay()] ?? ""
    const day = String(parsed.getUTCDate()).padStart(2, "0")
    const month = MONTH_LABELS[parsed.getUTCMonth()] ?? ""
    const year = String(parsed.getUTCFullYear()).slice(-2)

    return `${weekday} ${day} ${month}, '${year}`
}

const getCurrentLimaClock = (): LimaClock => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(new Date())

    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const dateKey = `${values.year}-${values.month}-${values.day}`
    const hours = Number(values.hour ?? "0")
    const minutes = Number(values.minute ?? "0")

    return {
        dateKey,
        minutes: hours * 60 + minutes,
    }
}

const getPoolSlotStartMinutes = (ticket: TicketTypeClient): number | null => {
    if (!ticket.servilexExtraConfig || typeof ticket.servilexExtraConfig !== "object" || Array.isArray(ticket.servilexExtraConfig)) {
        return null
    }

    const raw = (ticket.servilexExtraConfig as Record<string, unknown>).horaInicio
    if (typeof raw !== "string") return null
    const match = /^(\d{2}):(\d{2})$/.exec(raw.trim())
    if (!match) return null

    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
    return hours * 60 + minutes
}

const getPoolSlotLabel = (ticket: TicketTypeClient): string => {
    if (ticket.servilexExtraConfig && typeof ticket.servilexExtraConfig === "object" && !Array.isArray(ticket.servilexExtraConfig)) {
        const record = ticket.servilexExtraConfig as Record<string, unknown>
        const horaInicio = typeof record.horaInicio === "string" ? record.horaInicio.trim() : ""
        const horaFin = typeof record.horaFin === "string" ? record.horaFin.trim() : ""
        if (horaInicio && horaFin) {
            return `${normalizeTimeLabel(horaInicio)} - ${normalizeTimeLabel(horaFin)}`
        }
    }
    return ticket.name
}

const normalizeScheduleDatesForEventRange = (
    dates: string[],
    eventStartDate?: string | Date,
    eventEndDate?: string | Date
): string[] => {
    if (!eventStartDate || !eventEndDate || dates.length === 0) return dates

    const startKey = toDateKeyUTC(eventStartDate)
    const endKey = toDateKeyUTC(eventEndDate)
    if (!startKey || !endKey) return dates

    const normalizedDates = dates.filter((date) => DATE_REGEX.test(date))
    if (normalizedDates.length !== dates.length) return dates

    const inRangeCount = normalizedDates.filter((date) => date >= startKey && date <= endKey).length
    const shiftedDates = normalizedDates.map((date) => addDaysToDateKey(date, 1))
    const shiftedInRangeCount = shiftedDates.filter((date) => date >= startKey && date <= endKey).length

    if (shiftedInRangeCount === normalizedDates.length && shiftedInRangeCount > inRangeCount) {
        return shiftedDates
    }

    return dates
}

export default function TicketPurchaseCard({
    eventId,
    eventTitle,
    eventCategory,
    ticketTypes,
    eventStartDate,
    eventEndDate,
}: TicketPurchaseCardProps) {
    const { addItem, updateQuantity, removeItem, items, itemCount } = useCart()
    const { status } = useSession()
    const router = useRouter()

    // Courtesy claim state
    const [showCourtesy, setShowCourtesy] = useState(false)
    const [courtesyCode, setCourtesyCode] = useState("")
    const [courtesyLoading, setCourtesyLoading] = useState(false)
    const [courtesyError, setCourtesyError] = useState("")
    const [courtesyData, setCourtesyData] = useState<{
        ticketType: string
        hasAssignedAttendee: boolean
        assignedName: string | null
        assignedDniMasked: string | null
    } | null>(null)
    const [courtesySuccess, setCourtesySuccess] = useState(false)
    const [attendeeName, setAttendeeName] = useState("")
    const [attendeeDni, setAttendeeDni] = useState("")

    const [liveStockById, setLiveStockById] = useState<
        Record<string, { sold: number; capacity: number; isActive: boolean; dateInventories?: DateInventoryClient[] }>
    >({})
    const [showAllPoolSlots, setShowAllPoolSlots] = useState(false)
    const [selectedPoolSlotKey, setSelectedPoolSlotKey] = useState<string | null>(null)
    const [mounted, setMounted] = useState(false)
    const [limaClock, setLimaClock] = useState<LimaClock | null>(null)

    useEffect(() => {
        setMounted(true)
    }, [])

    useEffect(() => {
        if (!isPoolFreeEventCategory(eventCategory)) return

        const updateClock = () => setLimaClock(getCurrentLimaClock())
        updateClock()

        const interval = window.setInterval(updateClock, 60_000)
        return () => window.clearInterval(interval)
    }, [eventCategory])

    useEffect(() => {
        let cancelled = false

        const fetchStock = async () => {
            try {
                const response = await fetch(`/api/events/${eventId}/stock`, {
                    cache: "no-store",
                })
                if (!response.ok) return

                const payload = await response.json() as {
                    success?: boolean
                    data?: Array<{
                        id: string
                        sold: number
                        capacity: number
                        isActive: boolean
                        dateInventories?: DateInventoryClient[]
                    }>
                }

                if (!payload.success || !Array.isArray(payload.data) || cancelled) return

                const nextState: Record<string, { sold: number; capacity: number; isActive: boolean; dateInventories?: DateInventoryClient[] }> = {}
                for (const item of payload.data) {
                    nextState[item.id] = {
                        sold: item.sold,
                        capacity: item.capacity,
                        isActive: item.isActive,
                        dateInventories: item.dateInventories,
                    }
                }

                setLiveStockById(nextState)
            } catch {
                // Mantener ultimo valor conocido si falla el polling.
            }
        }

        void fetchStock()
        const interval = window.setInterval(() => {
            void fetchStock()
        }, 10000)

        return () => {
            cancelled = true
            window.clearInterval(interval)
        }
    }, [eventId])

    const ticketTypesWithLiveStock = useMemo(() => {
        return ticketTypes.map((ticket) => {
            const live = liveStockById[ticket.id]
            if (!live) return ticket
            return {
                ...ticket,
                sold: live.sold,
                capacity: live.capacity,
                isActive: live.isActive,
                dateInventories: live.dateInventories ?? ticket.dateInventories,
            }
        })
    }, [ticketTypes, liveStockById])

    const ticketMeta = useMemo(() => {
        return ticketTypesWithLiveStock.map((ticket) => {
            const usesDailyCapacity = isPoolFreeEventCategory(eventCategory)
            const schedule = parseTicketScheduleConfig(ticket.validDays)
            let normalizedDates = normalizeScheduleDatesForEventRange(
                schedule.dates,
                eventStartDate,
                eventEndDate
            )
            if (
                usesDailyCapacity &&
                normalizedDates.length === 0 &&
                eventStartDate &&
                eventEndDate
            ) {
                normalizedDates = getPoolFreeSelectableDates({
                    validDays: ticket.validDays,
                    eventStartDate: new Date(eventStartDate),
                    eventEndDate: new Date(eventEndDate),
                })
            }

            const inventoryByDate = new Map(
                (ticket.dateInventories ?? [])
                    .map((inventory) => {
                        const dateKey = toDateKeyUTC(inventory.date)
                        return dateKey ? [dateKey, inventory] : null
                    })
                    .filter(Boolean) as Array<[string, DateInventoryClient]>
            )
            const available = usesDailyCapacity
                ? (ticket.capacity === 0 ? null : ticket.capacity)
                : (ticket.capacity === 0 ? null : ticket.capacity - ticket.sold)
            const maxQty = available === null ? MAX_UNLIMITED_QTY : Math.max(0, available)
            const soldOut = usesDailyCapacity
                ? ticket.isActive === false
                : ticket.isActive === false || (available !== null && available <= 0)
            const dateStates = normalizedDates.map((date) => {
                const inventory = inventoryByDate.get(date)
                const capacity = inventory?.capacity ?? ticket.capacity
                const sold = inventory?.sold ?? 0
                const isEnabled = ticket.isActive !== false && (inventory?.isEnabled ?? true)
                const dateSoldOut = capacity !== 0 && sold >= capacity

                return {
                    date,
                    capacity,
                    sold,
                    isEnabled,
                    soldOut: dateSoldOut,
                    available: capacity === 0 ? null : Math.max(0, capacity - sold),
                }
            })
            return {
                ticket,
                available,
                maxQty,
                soldOut,
                usesDailyCapacity,
                dateStates,
                schedule: {
                    ...schedule,
                    dates: normalizedDates,
                },
            }
        })
    }, [ticketTypesWithLiveStock, eventCategory, eventStartDate, eventEndDate])

    const poolSlotOptions = useMemo<PoolSlotOption[]>(() => {
        if (!isPoolFreeEventCategory(eventCategory)) return []

        return ticketMeta.flatMap((entry) =>
            entry.dateStates
                .filter((dateState) => {
                    if (!dateState.isEnabled) return false
                    if (!limaClock) return true
                    if (dateState.date < limaClock.dateKey) return false
                    if (dateState.date > limaClock.dateKey) return true

                    const startMinutes = getPoolSlotStartMinutes(entry.ticket)
                    if (startMinutes === null) return true
                    return startMinutes > limaClock.minutes
                })
                .map((dateState) => ({
                    key: `${entry.ticket.id}:${dateState.date}`,
                    ticketId: entry.ticket.id,
                    date: dateState.date,
                    label: getPoolSlotLabel(entry.ticket),
                    price: entry.ticket.price,
                    selectable: !dateState.soldOut,
                    ticketName: entry.ticket.name,
                }))
        ).sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date)
            return a.label.localeCompare(b.label)
        })
    }, [eventCategory, limaClock, ticketMeta])

    useEffect(() => {
        if (!isPoolFreeEventCategory(eventCategory)) return
        if (poolSlotOptions.length === 0) {
            setSelectedPoolSlotKey(null)
            return
        }

        setSelectedPoolSlotKey((prev) => {
            if (prev && poolSlotOptions.some((slot) => slot.key === prev && slot.selectable)) {
                return prev
            }
            return poolSlotOptions.find((slot) => slot.selectable)?.key ?? poolSlotOptions[0]?.key ?? null
        })
    }, [eventCategory, poolSlotOptions])

    const selectedPoolSlot = useMemo(
        () => poolSlotOptions.find((slot) => slot.key === selectedPoolSlotKey) ?? null,
        [poolSlotOptions, selectedPoolSlotKey]
    )
    const safeItemCount = mounted ? itemCount : 0

    const visibleTicketMeta = useMemo(() => {
        if (!isPoolFreeEventCategory(eventCategory)) return ticketMeta
        if (!selectedPoolSlot) return []
        return ticketMeta.filter((entry) => entry.ticket.id === selectedPoolSlot.ticketId)
    }, [eventCategory, selectedPoolSlot, ticketMeta])

    const getCartQuantity = (itemKey: string) => {
        if (!mounted) return 0
        const found = items.find((item) => (item.lineKey || item.ticketTypeId) === itemKey)
        return found?.quantity || 0
    }

    const handleIncrement = (ticketId: string, maxQty: number, selectedDate?: string) => {
        const metadata = ticketMeta.find((entry) => entry.ticket.id === ticketId)
        if (!metadata) return
        const ticket = metadata.ticket
        if (maxQty <= 0) return
        const itemKey = selectedDate ? `${ticketId}:${selectedDate}` : ticketId

        const currentQty = getCartQuantity(itemKey)
        const nextQty = Math.min(currentQty + 1, maxQty)
        if (currentQty === 0) {
            addItem({
                lineKey: itemKey,
                ticketTypeId: ticket.id,
                ticketTypeName: ticket.name,
                eventId,
                eventTitle,
                price: ticket.price,
                quantity: 1,
                scheduleConfig: {
                    dates: selectedDate ? [selectedDate] : metadata.schedule.dates,
                    shifts: metadata.schedule.shifts,
                    requiredDays: ticket.isPackage ? (ticket.packageDaysCount ?? null) : null,
                    requireShiftSelection: metadata.schedule.requireShiftSelection,
                },
                servilexEnabled: Boolean(ticket.servilexEnabled),
                servilexIndicator: ticket.servilexIndicator || null,
            })
            return
        }
        updateQuantity(itemKey, nextQty)
    }

    const handleDecrement = (ticketId: string, selectedDate?: string) => {
        const itemKey = selectedDate ? `${ticketId}:${selectedDate}` : ticketId
        const currentQty = getCartQuantity(itemKey)
        if (currentQty <= 1) {
            removeItem(itemKey)
            return
        }
        updateQuantity(itemKey, currentQty - 1)
    }

    // Courtesy functions
    const handleVerifyCourtesy = async () => {
        if (!courtesyCode.trim()) return
        setCourtesyLoading(true)
        setCourtesyError("")
        setCourtesyData(null)
        
        try {
            const res = await fetch(`/api/courtesy/claim?code=${encodeURIComponent(courtesyCode)}`)
            const data = await res.json()
            
            if (data.valid) {
                if (data.data.event.id !== eventId) {
                    setCourtesyError(`Este código es para: ${data.data.event.title}`)
                } else {
                    setCourtesyData(data.data)
                }
            } else {
                setCourtesyError(data.error || "Código no válido")
            }
        } catch {
            setCourtesyError("Error al verificar código")
        } finally {
            setCourtesyLoading(false)
        }
    }

    const handleClaimCourtesy = async () => {
        if (status !== "authenticated") {
            router.push(`/login?callbackUrl=/eventos/${encodeURIComponent(eventTitle.toLowerCase().replace(/\s+/g, '-'))}`)
            return
        }

        if (!courtesyData?.hasAssignedAttendee && (!attendeeName || !attendeeDni)) {
            setCourtesyError("Completa nombre y DNI")
            return
        }

        setCourtesyLoading(true)
        setCourtesyError("")

        try {
            const res = await fetch("/api/courtesy/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: courtesyCode,
                    attendeeName: courtesyData?.hasAssignedAttendee ? undefined : attendeeName,
                    attendeeDni: courtesyData?.hasAssignedAttendee ? undefined : attendeeDni,
                }),
            })
            const data = await res.json()
            if (data.success) {
                setCourtesySuccess(true)
            } else {
                setCourtesyError(data.error || "Error al canjear")
            }
        } catch {
            setCourtesyError("Error al canjear")
        } finally {
            setCourtesyLoading(false)
        }
    }

    const resetCourtesy = () => {
        setShowCourtesy(false)
        setCourtesyCode("")
        setCourtesyData(null)
        setCourtesyError("")
        setCourtesySuccess(false)
        setAttendeeName("")
        setAttendeeDni("")
    }

    const isPoolFreeView = isPoolFreeEventCategory(eventCategory)

    const purchasePanel = (
        <>
            {visibleTicketMeta.map(({ ticket, available, maxQty, soldOut, usesDailyCapacity, schedule, dateStates }) => {
                const selectedDateState = usesDailyCapacity
                    ? dateStates.find((entry) => entry.date === selectedPoolSlot?.date)
                    : null
                const effectiveSoldOut = usesDailyCapacity
                    ? !selectedPoolSlot || !selectedDateState || !selectedDateState.isEnabled || selectedDateState.soldOut
                    : soldOut
                const effectiveMaxQty = usesDailyCapacity
                    ? selectedDateState?.available === null
                        ? MAX_UNLIMITED_QTY
                        : Math.max(0, selectedDateState?.available ?? 0)
                    : maxQty
                const cartKey = usesDailyCapacity && selectedPoolSlot ? selectedPoolSlot.key : ticket.id

                return (
                    <div
                        key={ticket.id}
                        className={`rounded-2xl border p-4 ${effectiveSoldOut ? "bg-gray-50 opacity-60" : "bg-white"}`}
                    >
                        <div className="mb-2 flex justify-between items-start">
                            <div>
                                <h4 className="font-semibold">{ticket.name}</h4>
                                {ticket.description && <p className="text-sm text-gray-500">{ticket.description}</p>}
                            </div>
                            <div className="text-right">
                                <div className="font-bold text-lg text-[hsl(210,100%,40%)]">{formatPrice(ticket.price)}</div>
                            </div>
                        </div>

                        {isPoolFreeView && selectedPoolSlot && (
                            <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                                <div className="font-semibold text-slate-900">{formatPoolSlotDateLabel(selectedPoolSlot.date)}</div>
                                <div>{selectedPoolSlot.label}</div>
                            </div>
                        )}

                        {ticket.isPackage && ticket.packageDaysCount ? (
                            <Badge variant="info" className="mb-2">
                                Paquete {ticket.packageDaysCount} clases
                            </Badge>
                        ) : null}
                        {!usesDailyCapacity && schedule.dates.length > 0 && (
                            <Badge variant="secondary" className="mb-2 ml-2">
                                {schedule.dates.length} días seleccionables
                            </Badge>
                        )}
                        {!usesDailyCapacity && schedule.shifts.length > 0 && (
                            <Badge variant="secondary" className="mb-2 ml-2">
                                Turnos configurados
                            </Badge>
                        )}
                        {!usesDailyCapacity && schedule.shifts.length > 0 && !schedule.requireShiftSelection && (
                            <Badge variant="secondary" className="mb-2 ml-2">
                                Válido en todos los turnos
                            </Badge>
                        )}
                        {(schedule.dates.length > 0 || schedule.shifts.length > 0) && (
                            <p className="text-xs text-gray-500 mt-1">
                                {usesDailyCapacity
                                    ? "La fecha seleccionada queda asociada a este horario."
                                    : "La selección de días/turnos se completa en checkout."}
                            </p>
                        )}

                        {effectiveSoldOut && (
                            <div className="bg-red-100 border border-red-300 rounded-lg p-3 mb-3 mt-3">
                                <div className="flex items-center gap-2 text-red-700 font-bold">
                                    <AlertCircle className="h-5 w-5" />
                                    <span className="text-lg">AGOTADO</span>
                                </div>
                                <p className="text-red-600 text-sm mt-1">No hay entradas disponibles para este tipo.</p>
                            </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-3">
                            {!effectiveSoldOut && (
                                <div className="ml-auto flex items-center gap-2">
                                    <span className="text-xs text-gray-500">Cantidad</span>
                                    <div className="flex items-center gap-2 rounded-full border px-2 py-1">
                                        <button
                                            type="button"
                                            className="h-7 w-7 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                            onClick={() => handleDecrement(ticket.id, usesDailyCapacity ? selectedPoolSlot?.date : undefined)}
                                            disabled={getCartQuantity(cartKey) === 0}
                                            aria-label="Quitar"
                                        >
                                            <Minus className="h-3 w-3 mx-auto" />
                                        </button>
                                        <span className="min-w-[1.5rem] text-center text-sm font-semibold">
                                            {getCartQuantity(cartKey)}
                                        </span>
                                        <button
                                            type="button"
                                            className="h-7 w-7 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                            onClick={() => handleIncrement(ticket.id, effectiveMaxQty, usesDailyCapacity ? selectedPoolSlot?.date : undefined)}
                                            disabled={
                                                (usesDailyCapacity && !selectedPoolSlot) ||
                                                getCartQuantity(cartKey) >= effectiveMaxQty
                                            }
                                            aria-label="Agregar"
                                        >
                                            <Plus className="h-3 w-3 mx-auto" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )
            })}

            {isPoolFreeView && !selectedPoolSlot && (
                <div className="rounded-2xl border border-dashed bg-white p-4 text-sm text-slate-500">
                    Selecciona un horario para habilitar la compra.
                </div>
            )}

            <div className="space-y-3 pt-2">
                <Button asChild className="w-full" size="lg" disabled={safeItemCount === 0}>
                    <Link href="/checkout">Ir a pagar</Link>
                </Button>
                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
                    <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>Podrás crear tu cuenta o iniciar sesión al momento de pagar.</span>
                </div>
            </div>
        </>
    )

    return (
        <Card className={isPoolFreeView ? "" : "sticky top-24"}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5" />
                    Entradas
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {ticketTypes.length > 0 ? (
                    <>
                        {isPoolFreeView ? (
                            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,380px)] xl:items-start">
                                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <h4 className="text-2xl font-bold text-slate-900">Fecha y Hora</h4>
                                            <p className="text-sm text-slate-500">
                                                Selecciona el día y horario para habilitar la compra.
                                            </p>
                                        </div>
                                        {poolSlotOptions.length > 6 && (
                                            <button
                                                type="button"
                                                className="text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                                                onClick={() => setShowAllPoolSlots((prev) => !prev)}
                                            >
                                                {showAllPoolSlots ? "Ver menos" : "Ver todas"}
                                            </button>
                                        )}
                                    </div>

                                    {poolSlotOptions.length > 0 ? (
                                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                                            {(showAllPoolSlots ? poolSlotOptions : poolSlotOptions.slice(0, 6)).map((slot) => {
                                                const isSelected = slot.key === selectedPoolSlotKey
                                                return (
                                                    <button
                                                        key={slot.key}
                                                        type="button"
                                                        className={`rounded-2xl border p-5 text-left transition ${
                                                            isSelected
                                                                ? "border-emerald-500 bg-emerald-50 shadow-sm"
                                                                : slot.selectable
                                                                  ? "border-slate-200 bg-white hover:border-emerald-300"
                                                                  : "border-slate-200 bg-slate-100 opacity-60"
                                                        }`}
                                                        onClick={() => slot.selectable && setSelectedPoolSlotKey(slot.key)}
                                                        disabled={!slot.selectable}
                                                    >
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div className="space-y-2">
                                                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                                                    <Calendar className="h-4 w-4 text-slate-500" />
                                                                    {formatPoolSlotDateLabel(slot.date)}
                                                                </div>
                                                                <div className="flex items-center gap-2 text-2xl font-bold leading-tight text-slate-900">
                                                                    <Clock className="h-5 w-5 text-slate-500" />
                                                                    <span>{slot.label}</span>
                                                                </div>
                                                            </div>
                                                            {isSelected ? (
                                                                <CheckCircle className="h-5 w-5 text-emerald-600" />
                                                            ) : slot.selectable ? (
                                                                <ChevronRight className="h-5 w-5 text-slate-400" />
                                                            ) : (
                                                                <span className="text-xs font-semibold uppercase text-slate-500">No disponible</span>
                                                            )}
                                                        </div>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    ) : (
                                        <div className="rounded-lg border border-dashed bg-white px-4 py-3 text-sm text-slate-500">
                                            No hay horarios habilitados por el momento.
                                        </div>
                                    )}
                                </div>

                                <div className="space-y-4 xl:sticky xl:top-24">
                                    {purchasePanel}
                                </div>
                            </div>
                        ) : (
                            purchasePanel
                        )}
                    </>
                ) : (
                    <div className="text-center py-6 text-gray-500">
                        <ShoppingCart className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                        <p>Las entradas aun no estan disponibles</p>
                    </div>
                )}

                {/* Sección de Cortesía */}
                <div className="border-t mt-6 pt-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Gift className="h-5 w-5 text-purple-600" />
                        <h3 className="font-semibold text-gray-900">¿Tienes un código de cortesía?</h3>
                    </div>

                    {courtesySuccess ? (
                        <div className="text-center py-4">
                            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
                            <p className="text-green-700 font-medium mb-2">¡Entrada canjeada exitosamente!</p>
                            <p className="text-sm text-gray-600 mb-4">Tu entrada ha sido registrada</p>
                            <div className="flex flex-col gap-2">
                                <Button asChild>
                                    <Link href="/mi-cuenta/entradas">
                                        <Ticket className="h-4 w-4 mr-2" />
                                        Ver Mis Entradas
                                    </Link>
                                </Button>
                                <Button variant="outline" onClick={resetCourtesy}>
                                    Canjear otro código
                                </Button>
                            </div>
                        </div>
                    ) : courtesyData ? (
                        <div className="space-y-4">
                            <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                                <p className="text-green-800 font-medium">Código válido</p>
                                <p className="text-sm text-green-700">Entrada: {courtesyData.ticketType}</p>
                            </div>
                            
                            {!courtesyData.hasAssignedAttendee && (
                                <div className="space-y-3">
                                    <p className="text-sm text-gray-600">
                                        Este código requiere que ingreses los datos del asistente:
                                    </p>
                                    <Input
                                        placeholder="Nombre completo del asistente"
                                        value={attendeeName}
                                        onChange={(e) => setAttendeeName(e.target.value)}
                                    />
                                    <Input
                                        placeholder="DNI del asistente"
                                        value={attendeeDni}
                                        onChange={(e) => setAttendeeDni(e.target.value)}
                                    />
                                </div>
                            )}

                            {courtesyData.hasAssignedAttendee && (
                                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                                    <p className="text-sm text-blue-700">
                                        <span className="font-medium">Asignado a:</span> {courtesyData.assignedName} ({courtesyData.assignedDniMasked})
                                    </p>
                                </div>
                            )}
                            
                            {courtesyError && (
                                <div className="flex items-center gap-2 text-red-600 text-sm">
                                    <AlertCircle className="h-4 w-4" />
                                    {courtesyError}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    onClick={handleClaimCourtesy}
                                    disabled={courtesyLoading}
                                    className="flex-1"
                                >
                                    {courtesyLoading ? 'Canjeando...' : 'Canjear entrada'}
                                </Button>
                                <Button variant="outline" onClick={resetCourtesy}>
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Ingresa tu código de cortesía"
                                    value={courtesyCode}
                                    onChange={(e) => setCourtesyCode(e.target.value.toUpperCase())}
                                    className="flex-1 font-mono"
                                />
                                <Button
                                    onClick={handleVerifyCourtesy}
                                    disabled={courtesyLoading || !courtesyCode.trim()}
                                >
                                    {courtesyLoading ? 'Verificando...' : 'Verificar'}
                                </Button>
                            </div>
                            
                            {courtesyError && (
                                <div className="flex items-center gap-2 text-red-600 text-sm">
                                    <AlertCircle className="h-4 w-4" />
                                    {courtesyError}
                                </div>
                            )}
                            
                            <p className="text-xs text-gray-500">
                                Si recibiste un código de cortesía, ingrésalo aquí para obtener tu entrada gratuita.
                            </p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
