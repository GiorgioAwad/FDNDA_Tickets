"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, UserCheck, UserPlus, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react"

export interface AttendanceEventOption {
    id: string
    title: string
    startDate: string
    endDate: string
    category: string
}

interface MembershipInfo {
    isMembership: boolean
    /** Varios ingresos por día (doble asistencia): ORO y BRONCE/PLATA con el flag. */
    multiDaily: boolean
    planLabel: string
    categoryLabel: string | null
    frequencyLabel: string | null
    scheduleText: string | null
    daysLabel: string | null
    freeAccess: boolean
    /** Solo planes con varios ingresos: tope e ingresos de hoy. */
    dailyLimit?: number
    dailyUsed?: number
    /** Beneficio acumulado de acompañantes para membresías ORO. */
    guestPasses?: { limit: number; used: number; remaining: number }
}

interface TicketResult {
    id: string
    ticketCode: string
    attendeeName: string | null
    attendeeDni: string | null
    ticketType: { name: string; isPackage: boolean }
    attendance: { total: number; used: number; remaining: number }
    todayStatus: "AVAILABLE" | "USED" | "NO_ENTITLEMENT"
    membership: MembershipInfo | null
}

interface MarkResult {
    ticketId: string
    success: boolean
    message: string
    attendance?: { total: number; used: number; remaining: number }
}

/** Clases del badge de plan según el nivel de membresía. */
const planBadgeClass = (planLabel: string): string => {
    if (planLabel === "ORO") return "bg-amber-100 text-amber-800 border-amber-200"
    if (planLabel === "PLATA") return "bg-slate-100 text-slate-700 border-slate-200"
    if (planLabel.startsWith("BRONCE")) return "bg-orange-100 text-orange-800 border-orange-200"
    return "bg-blue-100 text-blue-800 border-blue-200"
}

interface ManualAttendancePanelProps {
    /** Eventos vigentes provistos por el server (ya filtrados/ordenados). */
    events: AttendanceEventOption[]
}

/**
 * Panel de asistencia manual: busca por DNI/nombre y marca asistencia sin QR.
 * Los eventos llegan por props (el server los provee según el rol), por lo que
 * este panel se puede montar tanto en /admin/asistencia (ADMIN) como en
 * /scanner/asistencia (STAFF) sin depender del endpoint admin de eventos.
 */
export default function ManualAttendancePanel({ events }: ManualAttendancePanelProps) {
    const [selectedEventId, setSelectedEventId] = useState("")
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<TicketResult[]>([])
    const [searching, setSearching] = useState(false)
    const [markingId, setMarkingId] = useState<string | null>(null)
    const [markResults, setMarkResults] = useState<Record<string, MarkResult>>({})
    const [registeringGuestPassId, setRegisteringGuestPassId] = useState<string | null>(null)
    const [guestPassResults, setGuestPassResults] = useState<Record<string, MarkResult>>({})
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Search tickets
    const searchTickets = useCallback(async (eventId: string, searchQuery: string) => {
        if (!eventId || searchQuery.length < 3) {
            setResults([])
            return
        }

        setSearching(true)
        try {
            const res = await fetch("/api/scans/search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ eventId, query: searchQuery }),
            })
            const data = await res.json()
            if (data.success) {
                setResults(data.data)
            } else {
                setResults([])
            }
        } catch {
            console.error("Error searching")
        } finally {
            setSearching(false)
        }
    }, [])

    // Debounced search on query change
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        if (!selectedEventId || query.length < 3) {
            setResults([])
            return
        }
        debounceRef.current = setTimeout(() => {
            searchTickets(selectedEventId, query)
        }, 350)
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [query, selectedEventId, searchTickets])

    // Mark attendance
    const handleMarkAttendance = async (ticket: TicketResult) => {
        setMarkingId(ticket.id)
        try {
            const res = await fetch("/api/scans/lookup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ticketCode: ticket.ticketCode,
                    eventId: selectedEventId,
                }),
            })
            const data = await res.json()

            setMarkResults((prev) => ({
                ...prev,
                [ticket.id]: {
                    ticketId: ticket.id,
                    success: data.valid === true,
                    message: data.message || (data.valid ? "Asistencia registrada" : "Error"),
                    attendance: data.attendance,
                },
            }))

            // Update the ticket in results
            if (data.attendance) {
                setResults((prev) =>
                    prev.map((t) => {
                        if (t.id !== ticket.id) return t
                        const multiDaily = t.membership?.multiDaily === true
                        const dailyLimit = t.membership?.dailyLimit ?? 2
                        const nextDailyUsed =
                            typeof data.dailyUsed === "number" ? data.dailyUsed : t.membership?.dailyUsed
                        const nextMembership = t.membership
                            ? { ...t.membership, dailyUsed: nextDailyUsed }
                            : t.membership
                        // Doble asistencia: mantener "AVAILABLE" mientras queden ingresos
                        // del día, para que el botón siga disponible para el 2º ingreso.
                        const dailyExhausted = multiDaily ? (nextDailyUsed ?? 0) >= dailyLimit : true
                        return {
                            ...t,
                            attendance: data.attendance,
                            todayStatus: data.valid && dailyExhausted ? ("USED" as const) : t.todayStatus,
                            membership: nextMembership,
                        }
                    })
                )
            }
        } catch {
            setMarkResults((prev) => ({
                ...prev,
                [ticket.id]: {
                    ticketId: ticket.id,
                    success: false,
                    message: "Error de conexion",
                },
            }))
        } finally {
            setMarkingId(null)
        }
    }

    const handleRegisterGuestPass = async (ticket: TicketResult) => {
        const guestPasses = ticket.membership?.guestPasses
        if (!guestPasses || guestPasses.remaining <= 0) return

        const confirmed = window.confirm(
            `¿Registrar un pase gratis para un acompañante de ${ticket.attendeeName || "esta membresía"}? ` +
                `Después quedarán ${guestPasses.remaining - 1}.`
        )
        if (!confirmed) return

        setRegisteringGuestPassId(ticket.id)
        try {
            const res = await fetch("/api/scans/guest-pass", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticketId: ticket.id, eventId: selectedEventId }),
            })
            const data = await res.json()
            const success = res.ok && data.success === true

            setGuestPassResults((prev) => ({
                ...prev,
                [ticket.id]: {
                    ticketId: ticket.id,
                    success,
                    message: data.message || data.error || "No se pudo registrar el pase gratis",
                },
            }))

            if (data.guestPasses) {
                setResults((prev) =>
                    prev.map((current) =>
                        current.id === ticket.id && current.membership
                            ? {
                                  ...current,
                                  membership: {
                                      ...current.membership,
                                      guestPasses: data.guestPasses,
                                  },
                              }
                            : current
                    )
                )
            }
        } catch {
            setGuestPassResults((prev) => ({
                ...prev,
                [ticket.id]: {
                    ticketId: ticket.id,
                    success: false,
                    message: "Error de conexión",
                },
            }))
        } finally {
            setRegisteringGuestPassId(null)
        }
    }

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString("es-PE", {
            day: "2-digit",
            month: "short",
        })
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">Asistencia Manual</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Busca por DNI o nombre para marcar asistencia sin QR
                </p>
            </div>

            {/* Event Selector */}
            <div className="bg-white rounded-xl border p-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                    Selecciona el evento
                </label>
                {events.length === 0 ? (
                    <p className="text-sm text-gray-500">No hay eventos vigentes.</p>
                ) : (
                    <select
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        value={selectedEventId}
                        onChange={(e) => {
                            setSelectedEventId(e.target.value)
                            setResults([])
                            setMarkResults({})
                            setGuestPassResults({})
                            setQuery("")
                        }}
                    >
                        <option value="">-- Seleccionar evento --</option>
                        {events.map((event) => (
                            <option key={event.id} value={event.id}>
                                {event.title} ({formatDate(event.startDate)} - {formatDate(event.endDate)})
                            </option>
                        ))}
                    </select>
                )}
            </div>

            {/* Search */}
            {selectedEventId && (
                <div className="bg-white rounded-xl border p-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            className="pl-10"
                            placeholder="Buscar por DNI o nombre (min. 3 caracteres)..."
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            autoFocus
                        />
                    </div>
                    {searching && (
                        <div className="flex items-center gap-2 text-sm text-gray-500 mt-3">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Buscando...
                        </div>
                    )}
                </div>
            )}

            {/* Results */}
            {results.length > 0 && (
                <div className="space-y-3">
                    <p className="text-sm text-gray-500">
                        {results.length} resultado{results.length !== 1 ? "s" : ""}
                    </p>
                    {results.map((ticket) => {
                        const mark = markResults[ticket.id]
                        const guestPassMark = guestPassResults[ticket.id]
                        const isMarking = markingId === ticket.id
                        const isRegisteringGuestPass = registeringGuestPassId === ticket.id
                        const membership = ticket.membership
                        const multiDaily = membership?.multiDaily === true
                        const dailyUsed = membership?.dailyUsed ?? 0
                        const dailyLimit = membership?.dailyLimit ?? 2
                        const canMark = multiDaily
                            ? dailyUsed < dailyLimit &&
                              (ticket.attendance.total <= 0 || ticket.attendance.remaining > 0)
                            : ticket.todayStatus !== "USED" && ticket.attendance.remaining > 0

                        return (
                            <div
                                key={ticket.id}
                                className={`bg-white rounded-xl border p-4 transition-colors ${
                                    mark?.success || guestPassMark?.success ? "border-green-200 bg-green-50/50" : ""
                                }`}
                            >
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                    {/* Info */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-semibold text-gray-900">
                                                {ticket.attendeeName || "Sin nombre"}
                                            </span>
                                            {ticket.attendeeDni && (
                                                <Badge variant="outline" className="font-mono text-xs">
                                                    DNI: {ticket.attendeeDni}
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-500 mt-0.5">
                                            {ticket.ticketType.name}
                                        </p>

                                        {/* Membership: plan, schedule & frequency */}
                                        {membership?.isMembership && (
                                            <div className="mt-1.5 space-y-0.5">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <Badge className={planBadgeClass(membership.planLabel)}>
                                                        {membership.planLabel}
                                                    </Badge>
                                                    {membership.categoryLabel && (
                                                        <span className="text-xs text-gray-500">
                                                            {membership.categoryLabel}
                                                        </span>
                                                    )}
                                                </div>
                                                {membership.freeAccess ? (
                                                    <p className="text-xs text-gray-500">
                                                        Acceso libre · sin horario fijo
                                                    </p>
                                                ) : (
                                                    <>
                                                        {membership.frequencyLabel && (
                                                            <p className="text-xs text-gray-600">
                                                                <span className="text-gray-400">Frecuencia:</span>{" "}
                                                                {membership.frequencyLabel}
                                                            </p>
                                                        )}
                                                        {membership.scheduleText && (
                                                            <p className="text-xs text-gray-600">
                                                                <span className="text-gray-400">Horario:</span>{" "}
                                                                {membership.scheduleText}
                                                            </p>
                                                        )}
                                                    </>
                                                )}
                                                {multiDaily && (
                                                    <p className="text-xs text-gray-600">
                                                        <span className="text-gray-400">Ingresos hoy:</span>{" "}
                                                        {dailyUsed}/{dailyLimit}
                                                    </p>
                                                )}
                                                {membership.guestPasses && (
                                                    <p className="text-xs font-medium text-amber-700">
                                                        Pases gratis: {membership.guestPasses.used}/{membership.guestPasses.limit}
                                                        {membership.guestPasses.remaining > 0
                                                            ? ` (${membership.guestPasses.remaining} disponibles)`
                                                            : " (agotados)"}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {/* Attendance progress */}
                                        <div className="mt-2">
                                            <div className="flex items-center gap-2 text-xs text-gray-600">
                                                <span>
                                                    Asistencias: {ticket.attendance.used}/{ticket.attendance.total}
                                                </span>
                                                <span className="text-gray-400">
                                                    ({ticket.attendance.remaining} restantes)
                                                </span>
                                            </div>
                                            <div className="mt-1 h-1.5 w-full max-w-xs bg-gray-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500 rounded-full transition-all"
                                                    style={{
                                                        width: `${ticket.attendance.total > 0 ? (ticket.attendance.used / ticket.attendance.total) * 100 : 0}%`,
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Status & Action */}
                                    <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                                        {ticket.todayStatus === "USED" && !mark && !multiDaily && (
                                            <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                                Ya registrado hoy
                                            </Badge>
                                        )}
                                        {ticket.todayStatus === "NO_ENTITLEMENT" && ticket.attendance.remaining <= 0 && !mark && (
                                            <Badge className="bg-gray-100 text-gray-600 border-gray-200">
                                                Sin clases disponibles
                                            </Badge>
                                        )}

                                        {mark && (
                                            <Badge
                                                className={
                                                    mark.success
                                                        ? "bg-green-100 text-green-800 border-green-200"
                                                        : "bg-red-100 text-red-800 border-red-200"
                                                }
                                            >
                                                {mark.success ? (
                                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                                ) : (
                                                    <XCircle className="h-3 w-3 mr-1" />
                                                )}
                                                {mark.message}
                                            </Badge>
                                        )}
                                        {guestPassMark && (
                                            <Badge
                                                className={
                                                    guestPassMark.success
                                                        ? "bg-amber-100 text-amber-800 border-amber-200"
                                                        : "bg-red-100 text-red-800 border-red-200"
                                                }
                                            >
                                                {guestPassMark.success ? (
                                                    <CheckCircle2 className="h-3 w-3 mr-1" />
                                                ) : (
                                                    <XCircle className="h-3 w-3 mr-1" />
                                                )}
                                                {guestPassMark.message}
                                            </Badge>
                                        )}
                                        {canMark && (
                                            <Button
                                                size="sm"
                                                onClick={() => handleMarkAttendance(ticket)}
                                                disabled={isMarking}
                                                className="gap-1.5"
                                            >
                                                {isMarking ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <UserCheck className="h-4 w-4" />
                                                )}
                                                {multiDaily && dailyUsed >= 1 ? "Marcar 2º ingreso" : "Marcar Asistencia"}
                                            </Button>
                                        )}
                                        {membership?.guestPasses && membership.guestPasses.remaining > 0 && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleRegisterGuestPass(ticket)}
                                                disabled={isRegisteringGuestPass}
                                                className="gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50"
                                            >
                                                {isRegisteringGuestPass ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                ) : (
                                                    <UserPlus className="h-4 w-4" />
                                                )}
                                                Registrar pase gratis
                                            </Button>
                                        )}
                                        {membership?.guestPasses?.remaining === 0 && !guestPassMark && (
                                            <Badge className="bg-gray-100 text-gray-600 border-gray-200">
                                                3 pases gratis utilizados
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Empty states */}
            {!searching && query.length >= 3 && results.length === 0 && selectedEventId && (
                <div className="bg-white rounded-xl border p-8 text-center">
                    <Search className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500">No se encontraron resultados para &quot;{query}&quot;</p>
                    <p className="text-sm text-gray-400 mt-1">Intenta con otro DNI o nombre</p>
                </div>
            )}

            {!selectedEventId && events.length > 0 && (
                <div className="bg-white rounded-xl border p-8 text-center">
                    <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500">Selecciona un evento para comenzar</p>
                </div>
            )}
        </div>
    )
}
