"use client"

import { useEffect, useMemo, useState } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import { Calendar, Clock, MapPin, User, Loader2, Plus, X, CheckCircle2, Ticket as TicketIcon } from "lucide-react"

interface PoolBagReservation {
    id: string
    date: string
    shift: string
    status: "RESERVED" | "USED" | "CANCELLED"
    usedAt: string | null
}

interface PoolBagSlot {
    ticketTypeId: string
    name: string
    shift: string
    startMinutes: number | null
    price: number
    capacity: number
    dateInventories: { date: string; capacity: number; sold: number; isEnabled: boolean }[]
}

export interface PoolBagTicket {
    id: string
    ticketCode: string
    attendeeName: string
    status: "ACTIVE" | "CANCELLED" | "EXPIRED"
    event: { title: string; venue: string; location: string }
    ticketType: { name: string }
    order?: { user?: { name?: string; email?: string } }
    qrDataUrl: string | null
    qrDate: string | null
    qrShift?: string | null
    poolBag: {
        credits: { total: number; used: number; reserved: number; available: number }
        reservations: PoolBagReservation[]
        today: string
        slots: PoolBagSlot[]
        eventStart: string
        eventEnd: string
    }
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"] as const
const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] as const

const enumerateDates = (start: string, end: string): string[] => {
    if (!DATE_REGEX.test(start) || !DATE_REGEX.test(end)) return []
    const out: string[] = []
    const current = new Date(`${start}T00:00:00Z`)
    const last = new Date(`${end}T00:00:00Z`)
    let guard = 0
    while (current <= last && guard < 1000) {
        out.push(current.toISOString().slice(0, 10))
        current.setUTCDate(current.getUTCDate() + 1)
        guard += 1
    }
    return out
}

const formatDateLabel = (value: string): string => {
    if (!DATE_REGEX.test(value)) return value
    const d = new Date(`${value}T12:00:00Z`)
    return `${WEEKDAY_LABELS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")} ${MONTH_LABELS[d.getUTCMonth()]}`
}

const formatShift = (shift: string): string => {
    const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(shift.trim())
    if (!match) return shift
    const to12 = (h: number, m: number) => {
        const suffix = h >= 12 ? "p. m." : "a. m."
        const h12 = h % 12 === 0 ? 12 : h % 12
        return `${h12}:${String(m).padStart(2, "0")} ${suffix}`
    }
    return `${to12(Number(match[1]), Number(match[2]))} - ${to12(Number(match[3]), Number(match[4]))}`
}

const getLimaClock = (): { dateKey: string; minutes: number } => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(new Date())
    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]))
    return {
        dateKey: `${v.year}-${v.month}-${v.day}`,
        minutes: Number(v.hour ?? "0") * 60 + Number(v.minute ?? "0"),
    }
}

export function PoolBagCarnet({ ticket, onChange }: { ticket: PoolBagTicket; onChange: () => Promise<void> | void }) {
    const { poolBag } = ticket
    const { credits } = poolBag

    const [selectedDate, setSelectedDate] = useState<string>("")
    const [selectedSlot, setSelectedSlot] = useState<string>("")
    const [submitting, setSubmitting] = useState(false)
    const [cancellingId, setCancellingId] = useState<string | null>(null)
    const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
    const [clock, setClock] = useState(() => getLimaClock())

    useEffect(() => {
        const id = window.setInterval(() => setClock(getLimaClock()), 60_000)
        return () => window.clearInterval(id)
    }, [])

    // Slots ya reservados por esta bolsa (para no ofrecerlos de nuevo).
    const reservedKeys = useMemo(() => {
        const set = new Set<string>()
        for (const r of poolBag.reservations) {
            if (r.status === "RESERVED" || r.status === "USED") set.add(`${r.date}::${r.shift}`)
        }
        return set
    }, [poolBag.reservations])

    // Disponibilidad efectiva de (slot, fecha): fila de inventario o capacidad base.
    const availableSlotsForDate = useMemo(() => {
        const map = new Map<string, PoolBagSlot[]>()
        const dates = enumerateDates(
            poolBag.today > poolBag.eventStart ? poolBag.today : poolBag.eventStart,
            poolBag.eventEnd
        )
        for (const date of dates) {
            const options: PoolBagSlot[] = []
            for (const slot of poolBag.slots) {
                if (reservedKeys.has(`${date}::${slot.shift}`)) continue
                const inv = slot.dateInventories.find((i) => i.date === date)
                const capacity = inv?.capacity ?? slot.capacity
                const sold = inv?.sold ?? 0
                const isEnabled = inv?.isEnabled ?? true
                if (!isEnabled) continue
                const hasCupo = capacity === 0 || sold < capacity
                if (!hasCupo) continue
                // Hoy: no ofrecer horarios ya pasados.
                if (date === clock.dateKey && slot.startMinutes !== null && slot.startMinutes <= clock.minutes) {
                    continue
                }
                options.push(slot)
            }
            if (options.length > 0) {
                map.set(date, options.sort((a, b) => (a.startMinutes ?? 0) - (b.startMinutes ?? 0)))
            }
        }
        return map
    }, [poolBag, reservedKeys, clock])

    const dateOptions = useMemo(
        () => Array.from(availableSlotsForDate.keys()).sort((a, b) => a.localeCompare(b)),
        [availableSlotsForDate]
    )
    const slotOptions = useMemo(
        () => (selectedDate ? availableSlotsForDate.get(selectedDate) ?? [] : []),
        [selectedDate, availableSlotsForDate]
    )

    useEffect(() => {
        if (dateOptions.length === 0) {
            setSelectedDate("")
            return
        }
        setSelectedDate((prev) => (prev && dateOptions.includes(prev) ? prev : dateOptions[0]))
    }, [dateOptions])

    useEffect(() => {
        if (slotOptions.length === 0) {
            setSelectedSlot("")
            return
        }
        setSelectedSlot((prev) =>
            prev && slotOptions.some((s) => s.ticketTypeId === prev) ? prev : slotOptions[0].ticketTypeId
        )
    }, [selectedDate, slotOptions])

    const canReserve = credits.available > 0 && Boolean(selectedDate) && Boolean(selectedSlot)

    const handleReserve = async () => {
        if (!canReserve || submitting) return
        setSubmitting(true)
        setMessage(null)
        try {
            const res = await fetch("/api/pool-bag/reservations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ticketId: ticket.id,
                    slotTicketTypeId: selectedSlot,
                    date: selectedDate,
                }),
            })
            const payload = await res.json().catch(() => ({}))
            if (!res.ok || payload.success === false) {
                throw new Error(payload.error || "No se pudo reservar")
            }
            setMessage({ kind: "ok", text: "Visita reservada." })
            await onChange()
        } catch (err) {
            setMessage({ kind: "error", text: (err as Error).message || "No se pudo reservar" })
        } finally {
            setSubmitting(false)
        }
    }

    const handleCancel = async (reservationId: string) => {
        if (cancellingId) return
        if (!window.confirm("¿Cancelar esta visita? Se liberará el cupo y recuperarás el crédito.")) return
        setCancellingId(reservationId)
        setMessage(null)
        try {
            const res = await fetch(`/api/pool-bag/reservations/${reservationId}`, { method: "DELETE" })
            const payload = await res.json().catch(() => ({}))
            if (!res.ok || payload.success === false) {
                throw new Error(payload.error || "No se pudo cancelar")
            }
            setMessage({ kind: "ok", text: "Reserva cancelada." })
            await onChange()
        } catch (err) {
            setMessage({ kind: "error", text: (err as Error).message || "No se pudo cancelar" })
        } finally {
            setCancellingId(null)
        }
    }

    const upcoming = poolBag.reservations
        .filter((r) => r.status === "RESERVED")
        .sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift))
    const history = poolBag.reservations
        .filter((r) => r.status === "USED")
        .sort((a, b) => b.date.localeCompare(a.date) || a.shift.localeCompare(b.shift))

    return (
        <div className="ticket-container bg-white shadow-2xl rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-fdnda p-4 sm:p-6 text-white relative overflow-hidden">
                <div className="ticket-pattern absolute inset-0 opacity-10" />
                <div className="relative z-10 text-center">
                    <h2 className="font-bold text-lg sm:text-xl mb-2">{ticket.event.title}</h2>
                    <Badge className="bg-white/20 text-white border-0">{ticket.ticketType.name}</Badge>
                </div>
            </div>

            {/* QR de hoy */}
            <div className="bg-white p-5 sm:p-8 flex flex-col items-center justify-center border-b border-dashed border-gray-300 relative">
                <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full" />
                <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full" />

                {ticket.status !== "ACTIVE" ? (
                    <div className="w-44 h-44 sm:w-56 sm:h-56 flex items-center justify-center bg-gray-100 rounded-xl">
                        <span className="text-gray-400 font-medium">Bolsa inactiva</span>
                    </div>
                ) : ticket.qrDataUrl ? (
                    <>
                        <div className="bg-white p-2 rounded-xl shadow-inner mb-4">
                            <Image
                                src={ticket.qrDataUrl}
                                alt="QR de la visita de hoy"
                                width={256}
                                height={256}
                                unoptimized
                                className="w-44 h-44 sm:w-56 sm:h-56 object-contain"
                            />
                        </div>
                        <p className="text-sm text-gray-500 text-center">
                            Visita de hoy:{" "}
                            <span className="font-bold text-gray-900">{formatDate(ticket.qrDate ?? poolBag.today)}</span>
                        </p>
                        {ticket.qrShift && (
                            <p className="text-sm text-gray-500 text-center">
                                Horario: <span className="font-bold text-gray-900">{formatShift(ticket.qrShift)}</span>
                            </p>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full">
                            <CheckCircle2 className="h-3 w-3" />
                            Muestra este QR en la puerta hoy
                        </div>
                    </>
                ) : (
                    <div className="flex w-full flex-col items-center justify-center gap-3 py-6 text-center">
                        <div className="flex h-44 w-44 sm:h-56 sm:w-56 flex-col items-center justify-center gap-2 rounded-xl bg-blue-50 px-4">
                            <TicketIcon className="h-10 w-10 text-fdnda-secondary" />
                            <span className="text-sm font-semibold text-fdnda-secondary">Sin visita para hoy</span>
                        </div>
                        <p className="text-sm text-gray-600">
                            Reserva una visita abajo. El QR aparecerá aquí el día que elijas.
                        </p>
                    </div>
                )}
            </div>

            {/* Detalles */}
            <div className="bg-white p-4 sm:p-6 space-y-4">
                <div className="flex items-start gap-3">
                    <User className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                        <div className="text-xs text-gray-500">Titular</div>
                        <div className="font-medium">{ticket.order?.user?.name || ticket.attendeeName}</div>
                    </div>
                </div>
                <div className="flex items-start gap-3">
                    <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                    <div>
                        <div className="text-xs text-gray-500">Ubicacion</div>
                        <div className="font-medium">{ticket.event.venue}</div>
                        <div className="text-sm text-gray-500">{ticket.event.location}</div>
                    </div>
                </div>
                <div className="pt-4 mt-2 border-t flex justify-between items-center text-sm text-gray-500">
                    <span>Codigo:</span>
                    <span className="font-mono font-bold text-gray-700">{ticket.ticketCode}</span>
                </div>
            </div>

            {/* Créditos + reservar */}
            <div className="bg-white p-4 sm:p-6 border-t space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h3 className="text-base sm:text-lg font-semibold">Tus visitas</h3>
                        <p className="text-sm text-gray-500">
                            {credits.used} usadas · {credits.reserved} reservadas · {credits.available} por reservar (de {credits.total})
                        </p>
                    </div>
                    <Badge variant="secondary" className="text-xs">{credits.available} disponibles</Badge>
                </div>

                {credits.total > 0 && (
                    <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                        {Array.from({ length: credits.total }, (_, i) => {
                            const kind = i < credits.used ? "used" : i < credits.used + credits.reserved ? "reserved" : "free"
                            return (
                                <div
                                    key={i}
                                    className={`rounded-md border py-2 text-center text-[11px] font-semibold ${
                                        kind === "used"
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                            : kind === "reserved"
                                              ? "border-sky-200 bg-sky-50 text-sky-700"
                                              : "border-gray-200 bg-gray-50 text-gray-400"
                                    }`}
                                >
                                    {i + 1}
                                </div>
                            )
                        })}
                    </div>
                )}

                {ticket.status === "ACTIVE" && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                        <div className="mb-2 text-sm font-semibold text-slate-800">Reservar una visita</div>
                        {credits.available <= 0 ? (
                            <p className="text-sm text-gray-500">Ya reservaste o usaste todas tus visitas.</p>
                        ) : dateOptions.length === 0 ? (
                            <p className="text-sm text-gray-500">No hay horarios disponibles por el momento.</p>
                        ) : (
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                                <div className="flex-1">
                                    <label className="text-xs font-medium text-gray-600">Fecha</label>
                                    <div className="mt-1 flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2">
                                        <Calendar className="h-4 w-4 text-gray-400" />
                                        <select
                                            className="h-10 w-full bg-transparent text-sm outline-none"
                                            value={selectedDate}
                                            onChange={(e) => setSelectedDate(e.target.value)}
                                            disabled={submitting}
                                        >
                                            {dateOptions.map((date) => (
                                                <option key={date} value={date}>{formatDateLabel(date)}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs font-medium text-gray-600">Horario</label>
                                    <div className="mt-1 flex items-center gap-2 rounded-md border border-gray-300 bg-white px-2">
                                        <Clock className="h-4 w-4 text-gray-400" />
                                        <select
                                            className="h-10 w-full bg-transparent text-sm outline-none"
                                            value={selectedSlot}
                                            onChange={(e) => setSelectedSlot(e.target.value)}
                                            disabled={submitting || slotOptions.length === 0}
                                        >
                                            {slotOptions.map((slot) => (
                                                <option key={slot.ticketTypeId} value={slot.ticketTypeId}>
                                                    {formatShift(slot.shift)}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <Button type="button" onClick={handleReserve} disabled={!canReserve || submitting} className="gap-2">
                                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                    Reservar
                                </Button>
                            </div>
                        )}
                    </div>
                )}

                {message && (
                    <p className={`text-sm ${message.kind === "error" ? "text-red-600" : "text-emerald-600"}`}>
                        {message.text}
                    </p>
                )}

                {/* Próximas visitas */}
                {upcoming.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-sm font-semibold text-gray-800">Próximas visitas</div>
                        {upcoming.map((r) => {
                            const canCancel = r.date > poolBag.today
                            return (
                                <div key={r.id} className="flex items-center justify-between rounded-lg border border-sky-100 bg-sky-50 px-3 py-2">
                                    <div className="text-sm">
                                        <div className="font-medium text-sky-900">{formatDateLabel(r.date)}</div>
                                        <div className="text-xs text-sky-700">{formatShift(r.shift)}</div>
                                    </div>
                                    {canCancel ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="gap-1 text-red-600"
                                            onClick={() => handleCancel(r.id)}
                                            disabled={cancellingId === r.id}
                                        >
                                            {cancellingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                            Cancelar
                                        </Button>
                                    ) : (
                                        <span className="text-xs font-medium text-sky-700">
                                            {r.date === poolBag.today ? "Hoy" : "En curso"}
                                        </span>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* Historial */}
                {history.length > 0 && (
                    <div className="space-y-2">
                        <div className="text-sm font-semibold text-gray-800">Visitas usadas</div>
                        {history.map((r) => (
                            <div key={r.id} className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2">
                                <div className="text-sm">
                                    <div className="font-medium text-emerald-900">{formatDateLabel(r.date)}</div>
                                    <div className="text-xs text-emerald-700">{formatShift(r.shift)}</div>
                                </div>
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
