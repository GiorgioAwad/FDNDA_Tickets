"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Search, UserCheck, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react"

interface EventOption {
    id: string
    title: string
    startDate: string
    endDate: string
    category: string
}

interface TicketResult {
    id: string
    ticketCode: string
    attendeeName: string | null
    attendeeDni: string | null
    ticketType: { name: string; isPackage: boolean }
    attendance: { total: number; used: number; remaining: number }
    todayStatus: "AVAILABLE" | "USED" | "NO_ENTITLEMENT"
}

interface MarkResult {
    ticketId: string
    success: boolean
    message: string
    attendance?: { total: number; used: number; remaining: number }
}

export default function AsistenciaManualPage() {
    const [events, setEvents] = useState<EventOption[]>([])
    const [selectedEventId, setSelectedEventId] = useState("")
    const [query, setQuery] = useState("")
    const [results, setResults] = useState<TicketResult[]>([])
    const [searching, setSearching] = useState(false)
    const [markingId, setMarkingId] = useState<string | null>(null)
    const [markResults, setMarkResults] = useState<Record<string, MarkResult>>({})
    const [loadingEvents, setLoadingEvents] = useState(true)
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Fetch events on mount
    useEffect(() => {
        async function fetchEvents() {
            try {
                const res = await fetch("/api/events?admin=true")
                const data = await res.json()
                const allEvents: EventOption[] = (data.data ?? data.events ?? data ?? [])
                    .filter((e: EventOption) => new Date(e.endDate) >= new Date(new Date().toDateString()))
                    .sort((a: EventOption, b: EventOption) =>
                        new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
                    )
                setEvents(allEvents)
            } catch {
                console.error("Error fetching events")
            } finally {
                setLoadingEvents(false)
            }
        }
        fetchEvents()
    }, [])

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
                    prev.map((t) =>
                        t.id === ticket.id
                            ? {
                                ...t,
                                attendance: data.attendance,
                                todayStatus: data.valid ? "USED" as const : t.todayStatus,
                            }
                            : t
                    )
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
                {loadingEvents ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cargando eventos...
                    </div>
                ) : (
                    <select
                        className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                        value={selectedEventId}
                        onChange={(e) => {
                            setSelectedEventId(e.target.value)
                            setResults([])
                            setMarkResults({})
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
                        const isMarking = markingId === ticket.id
                        const canMark = ticket.todayStatus !== "USED" && ticket.attendance.remaining > 0

                        return (
                            <div
                                key={ticket.id}
                                className={`bg-white rounded-xl border p-4 transition-colors ${
                                    mark?.success ? "border-green-200 bg-green-50/50" : ""
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
                                        {ticket.todayStatus === "USED" && !mark && (
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

                                        {mark ? (
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
                                        ) : canMark ? (
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
                                                Marcar Asistencia
                                            </Button>
                                        ) : null}
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

            {!selectedEventId && !loadingEvents && (
                <div className="bg-white rounded-xl border p-8 text-center">
                    <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-gray-500">Selecciona un evento para comenzar</p>
                </div>
            )}
        </div>
    )
}
