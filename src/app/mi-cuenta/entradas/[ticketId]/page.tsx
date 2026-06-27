"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import {
    parseMembershipScheduleSelection,
    formatSlotLabel,
    type MembershipScheduleProfile,
    type MembershipScheduleSelection,
    type MembershipScheduleInput,
} from "@/lib/membership-schedule"
import { NextMonthScheduleEditor } from "@/components/membership/NextMonthScheduleEditor"
import { ArrowLeft, Calendar, Clock, MapPin, User, Download, Loader2, RefreshCw, Snowflake } from "lucide-react"
import Image from "next/image"

interface TicketDetail {
    id: string
    ticketCode: string
    attendeeName: string
    attendeeDni: string
    status: "ACTIVE" | "CANCELLED" | "EXPIRED"
    event: {
        title: string
        startDate: string
        endDate: string
        venue: string
        location: string
        category?: string
    }
    ticketType: {
        name: string
        isPackage?: boolean
        packageDaysCount?: number | null
        monthlyClassLimit?: number | null
        validDays?: unknown
    }
    isMembership?: boolean
    // Membresías de natación con horario semanal fijo (selección normalizada).
    membershipSchedule?: unknown
    membershipAttendance?: {
        total: number
        used: number
        remaining: number
        periodStart?: string | null
        membershipStart?: string | null
        membershipExpiry?: string | null
        durationMonths?: number | null
    } | null
    membershipFreeze?: {
        applied: {
            month: string
            start: string
            end: string
            createdAt: string
        } | null
        eligible: boolean
        availableMonths: {
            month: string
            startStr: string
            endStr: string
        }[]
        accessStatus: "OK" | "NOT_STARTED" | "EXPIRED" | "BLACKOUT" | "FROZEN" | "NOT_APPLICABLE"
        current: {
            month: string
            start: string
            end: string
        } | null
    } | null
    // Cambio de horario mensual (semestral/anual BRONCE/PLATA).
    monthlySchedule?: {
        profile: MembershipScheduleProfile
        current: MembershipScheduleSelection | null
        next: {
            monthIndex: number
            monthStart: string
            input: MembershipScheduleInput
            summary: string
        } | null
    } | null
    order?: {
        user?: {
            name?: string
            email?: string
        }
    }
    entitlements: {
        date: string
        status: "AVAILABLE" | "USED"
        usedAt: string | null
    }[]
    scanCount?: number
    scans?: { date: string; shift: string | null }[]
    shifts?: string[]
    scheduleSelections?: { date: string; shift: string | null }[]
    qrDataUrl: string
    qrDate: string
    qrShift?: string | null
}

const getWeekdayIndexes = (label: string) => {
    const map: Record<string, number> = {
        L: 1,
        M: 2,
        X: 3,
        J: 4,
        V: 5,
        S: 6,
        D: 0,
    }
    return label
        .split("-")
        .map((part) => map[part.toUpperCase()])
        .filter((val) => val !== undefined)
}

const extractDaysLabel = (name: string) => {
    const match = name.match(/Turno\s+([LMDXVJS-]+)/i) || name.match(/\b([LMDXVJS](?:-[LMDXVJS]){1,6})\b/i)
    return match?.[1]?.toUpperCase() ?? null
}

const extractClassCount = (name: string) => {
    const match = name.match(/(\d+)\s*clases?/i)
    return match ? Number(match[1]) : null
}

const toUtcDate = (value: Date | string) => {
    const d = value instanceof Date ? value : new Date(value)
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

const getDaysBetween = (start: Date, end: Date) => {
    const days: Date[] = []
    const current = toUtcDate(start)
    const endDate = toUtcDate(end)

    while (current <= endDate) {
        days.push(new Date(current))
        current.setUTCDate(current.getUTCDate() + 1)
    }

    return days
}

const buildValidDaysFromLabel = (start: Date, end: Date, label: string) => {
    const days = getWeekdayIndexes(label)
    if (!days.length) return []
    const results: Date[] = []
    const current = toUtcDate(start)
    const endDate = toUtcDate(end)

    while (current <= endDate) {
        if (days.includes(current.getUTCDay())) {
            results.push(new Date(current))
        }
        current.setUTCDate(current.getUTCDate() + 1)
    }
    return results
}

const formatDateKey = (value: Date | string) => {
    const date = toUtcDate(value)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const shortShiftLabel = (shift: string) => {
    return shift.replace(/\s*\(.*\)$/, "")
}

const formatMonthLabel = (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return month
    return formatDate(`${month}-01`, { month: "long", year: "numeric" })
}

const previousDateKey = (dateStr: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
    const date = new Date(`${dateStr}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - 1)
    return formatDateKey(date)
}

export default function TicketDetailPage() {
    const params = useParams()
    const [ticket, setTicket] = useState<TicketDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [freezeMonth, setFreezeMonth] = useState("")
    const [freezeSubmitting, setFreezeSubmitting] = useState(false)
    const [freezeMessage, setFreezeMessage] = useState("")
    const [freezeError, setFreezeError] = useState("")

    useEffect(() => {
        const fetchTicket = async () => {
            try {
                const response = await fetch(`/api/tickets/${params.ticketId}`, { cache: "no-store" })
                if (!response.ok) {
                    throw new Error("Error al cargar el ticket")
                }
                const data = await response.json()
                setTicket(data.data)
                setFreezeMonth(data.data?.membershipFreeze?.availableMonths?.[0]?.month ?? "")
            } catch (err) {
                setError("No se pudo cargar el ticket")
                console.error(err)
            } finally {
                setLoading(false)
            }
        }

        fetchTicket()
    }, [params.ticketId])

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (error || !ticket) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-4">
                <p className="text-red-500 mb-4">{error || "Ticket no encontrado"}</p>
                <Link href="/mi-cuenta/entradas">
                    <Button variant="outline">Volver a mis entradas</Button>
                </Link>
            </div>
        )
    }

    const handleFreezeSubmit = async () => {
        if (!ticket || !freezeMonth || freezeSubmitting) return

        const confirmed = window.confirm(
            `Se congelará tu membresía durante ${formatMonthLabel(freezeMonth)}. Esta acción solo puede usarse una vez por membresía.`
        )
        if (!confirmed) return

        setFreezeSubmitting(true)
        setFreezeError("")
        setFreezeMessage("")
        try {
            const response = await fetch(`/api/membership/${ticket.id}/freeze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ month: freezeMonth }),
            })
            const result = await response.json().catch(() => null)
            if (!response.ok || !result?.success) {
                throw new Error(result?.error || "No se pudo congelar la membresía")
            }

            const refreshed = await fetch(`/api/tickets/${ticket.id}`, { cache: "no-store" })
            const refreshedData = await refreshed.json().catch(() => null)
            if (refreshed.ok && refreshedData?.success) {
                setTicket(refreshedData.data)
                setFreezeMonth(refreshedData.data?.membershipFreeze?.availableMonths?.[0]?.month ?? "")
            }
            setFreezeMessage("Congelamiento registrado.")
        } catch (err) {
            setFreezeError(err instanceof Error ? err.message : "No se pudo congelar la membresía")
        } finally {
            setFreezeSubmitting(false)
        }
    }

    const isPiscina = ticket.event?.category === "PISCINA_LIBRE"
    const isEvento = ticket.event?.category === "EVENTO"
    const clasesLabel = isEvento ? "entradas" : "asistencias"
    const claseLabel = isEvento ? "Entrada" : "Asistencia"

    const entitlements = ticket.entitlements || []
    const classCount = extractClassCount(ticket.ticketType.name)
    const isMembership = Boolean(ticket.isMembership)
    // Antes de la fecha de inicio de la cohorte, la API no devuelve período
    // (periodStart = null): la membresía aún no arranca.
    const membershipNotStarted =
        isMembership && ticket.membershipAttendance != null && ticket.membershipAttendance.periodStart == null
    const membershipFrozen = ticket.membershipFreeze?.accessStatus === "FROZEN"
    const currentFreeze = ticket.membershipFreeze?.current ?? ticket.membershipFreeze?.applied ?? null
    const venueText = `${ticket.event?.venue ?? ""} ${ticket.event?.location ?? ""} ${ticket.event?.title ?? ""}`.toLowerCase()
    const isVidenaMembership = isMembership && venueText.includes("videna")
    let isPackageLike = Boolean(
        ticket.ticketType.isPackage || ticket.ticketType.packageDaysCount || classCount
    )

    // Piscina libre: tratar como paquete de 1 asistencia
    if (isPiscina) {
        isPackageLike = true
    }

    // Membresía: se muestra como paquete, pero el cupo es el del mes en curso
    if (isMembership) {
        isPackageLike = true
    }
    const label = extractDaysLabel(ticket.ticketType.name)
    const scheduleDays = !isPackageLike && ticket.event?.startDate && ticket.event?.endDate
        ? (label
            ? buildValidDaysFromLabel(new Date(ticket.event.startDate), new Date(ticket.event.endDate), label)
            : getDaysBetween(new Date(ticket.event.startDate), new Date(ticket.event.endDate)))
        : []
    const entitlementMap = new Map(
        entitlements.map((item) => [formatDateKey(item.date), item])
    )
    const usedCount = entitlements.filter((item) => item.status === "USED").length
    const scanUsedCount = ticket.scanCount ?? 0
    const effectiveUsedCount = Math.max(usedCount, scanUsedCount)

    // Multi-shift support
    const shifts = ticket.shifts || []
    const selectedQrShift = ticket.qrShift || null
    const hasMultipleShifts = shifts.length > 1 && !selectedQrShift
    const scans = ticket.scans || []
    const scheduleSelections = (ticket.scheduleSelections || []).filter((sel) => sel.date)
    const hasShiftSelections = scheduleSelections.some((sel) => sel.shift)
    const usesPurchasedDate = isPiscina || scheduleSelections.length > 0
    // Días concretos que el comprador eligió (entrada full-day / fecha comprada).
    // Cuando existen, el carnet debe limitarse a esos días en vez del rango completo
    // del evento, incluso si la selección no trae turno (full-day = todos los turnos del día).
    const purchasedDateKeys = !isPiscina && scheduleSelections.length > 0
        ? Array.from(new Set(scheduleSelections.map((sel) => sel.date))).sort((a, b) => a.localeCompare(b))
        : []

    // Match a scan's shift against a configured shift (flexible matching)
    const shiftMatchesConfig = (scanShift: string | null, configuredShift: string): boolean => {
        if (!scanShift) return false
        const a = scanShift.trim().toLowerCase()
        const b = configuredShift.trim().toLowerCase()
        if (a === b) return true
        // Compare short labels (without time range)
        return shortShiftLabel(scanShift).trim().toLowerCase() === shortShiftLabel(configuredShift).trim().toLowerCase()
    }

    let totalCount: number
    let displayEntitlements: { date: string; status: "AVAILABLE" | "USED"; usedAt: string | null; label?: string; shiftLabel?: string }[]
    let usedDisplayCount: number

    if (selectedQrShift && !isPackageLike) {
        totalCount = Math.max(entitlements.length, 1)
        const selectedShiftEntitlements = entitlements.length > 0
            ? entitlements
            : [{
                date: ticket.qrDate,
                status: "AVAILABLE" as const,
                usedAt: null,
            }]
        displayEntitlements = selectedShiftEntitlements.map((entitlement, index) => ({
            date: entitlement.date,
            status: entitlement.status,
            usedAt: entitlement.usedAt,
            label: `Entrada ${index + 1}`,
            shiftLabel: shortShiftLabel(selectedQrShift),
        }))
        usedDisplayCount = displayEntitlements.filter((item) => item.status === "USED").length
    } else if (hasShiftSelections && (isPackageLike || hasMultipleShifts)) {
        // Render strictly from the buyer's actual selections (date + shift pairs).
        // Avoids painting unselected shifts when the buyer only picked one per day.
        const sortedSelections = [...scheduleSelections].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date)
            return (a.shift ?? "").localeCompare(b.shift ?? "")
        })
        const uniqueDayKeys = Array.from(new Set(sortedSelections.map((sel) => sel.date)))
        const dayIndexByKey = new Map(uniqueDayKeys.map((key, index) => [key, index]))

        // Track which (date, shiftIdx-in-selections) is consumed by scans
        const usedSlots = new Set<number>()
        const remainingByDate = new Map<string, number[]>()
        sortedSelections.forEach((sel, idx) => {
            const list = remainingByDate.get(sel.date) ?? []
            list.push(idx)
            remainingByDate.set(sel.date, list)
        })

        for (const scan of scans) {
            const available = remainingByDate.get(scan.date)
            if (!available || available.length === 0) continue

            let chosen = -1
            for (let i = 0; i < available.length; i++) {
                const candidate = sortedSelections[available[i]]
                if (scan.shift && candidate.shift && shiftMatchesConfig(scan.shift, candidate.shift)) {
                    chosen = i
                    break
                }
                if (!scan.shift && !candidate.shift) {
                    chosen = i
                    break
                }
            }
            if (chosen === -1) chosen = 0
            const selIndex = available.splice(chosen, 1)[0]
            usedSlots.add(selIndex)
        }

        totalCount = sortedSelections.length
        displayEntitlements = sortedSelections.map((sel, index) => ({
            date: sel.date,
            status: usedSlots.has(index) ? ("USED" as const) : ("AVAILABLE" as const),
            usedAt: null,
            label: `Día ${(dayIndexByKey.get(sel.date) ?? 0) + 1}`,
            shiftLabel: sel.shift ? shortShiftLabel(sel.shift) : undefined,
        }))
        usedDisplayCount = displayEntitlements.filter((item) => item.status === "USED").length
    } else if (hasMultipleShifts && !isPackageLike) {
        // Multi-shift event-based (non-package with explicit days).
        // Si el comprador eligió días concretos (full-day: se elige el día e incluye
        // todos los turnos), pintar solo esos días en vez de todo el rango del evento.
        const days = purchasedDateKeys.length > 0
            ? purchasedDateKeys.map((key) => toUtcDate(key))
            : scheduleDays.length > 0 ? scheduleDays : entitlements.map((e) => new Date(e.date))
        totalCount = days.length * shifts.length
        displayEntitlements = []
        for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
            const dateKey = formatDateKey(days[dayIndex])
            for (let shiftIndex = 0; shiftIndex < shifts.length; shiftIndex++) {
                // Check if any scan matches this date+shift
                const used = scans.some(s =>
                    s.date === dateKey && (shiftMatchesConfig(s.shift, shifts[shiftIndex])
                        || (!s.shift && shiftIndex === 0)) // null shift -> count as first shift
                )
                displayEntitlements.push({
                    date: days[dayIndex] instanceof Date ? days[dayIndex].toISOString() : String(days[dayIndex]),
                    status: used ? "USED" : "AVAILABLE",
                    usedAt: null,
                    label: `Dia ${dayIndex + 1}`,
                    shiftLabel: shortShiftLabel(shifts[shiftIndex]),
                })
            }
        }
        usedDisplayCount = displayEntitlements.filter((item) => item.status === "USED").length
    } else if (isMembership && ticket.membershipAttendance) {
        // Membresía: cupo del mes en curso (reinicio sin acumular)
        totalCount = ticket.membershipAttendance.total
        usedDisplayCount = ticket.membershipAttendance.used
        displayEntitlements = Array.from({ length: totalCount }, (_, index) => ({
            date: `slot-${index + 1}`,
            status: index < usedDisplayCount ? ("USED" as const) : ("AVAILABLE" as const),
            usedAt: null,
        }))
    } else if (isPackageLike) {
        // Single-shift or no-shift package (original behavior)
        totalCount = ticket.ticketType.packageDaysCount ?? classCount ?? (isPiscina ? 1 : 0)
        displayEntitlements = Array.from({ length: totalCount }, (_, index) => ({
            date: `slot-${index + 1}`,
            status: index < effectiveUsedCount ? ("USED" as const) : ("AVAILABLE" as const),
            usedAt: null,
        }))
        usedDisplayCount = effectiveUsedCount
    } else {
        // Single-shift or no-shift event (original behavior).
        // Si el comprador eligió días concretos, limitar a esos días.
        const baseDays = purchasedDateKeys.length > 0
            ? purchasedDateKeys.map((key) => toUtcDate(key))
            : scheduleDays
        totalCount = baseDays.length > 0 ? baseDays.length : entitlements.length
        displayEntitlements = baseDays.length > 0
            ? baseDays.map((date) => {
                const key = formatDateKey(date)
                const existing = entitlementMap.get(key)
                return {
                    date: date.toISOString(),
                    status: existing?.status ?? ("AVAILABLE" as const),
                    usedAt: existing?.usedAt ?? null,
                }
            })
            : entitlements
        usedDisplayCount = displayEntitlements.filter((item) => item.status === "USED").length
    }

    const remainingCount = Math.max(totalCount - usedDisplayCount, 0)

    const shiftsPerDay = (() => {
        const byDate = new Map<string, number>()
        for (const item of displayEntitlements) {
            if (!item.shiftLabel) continue
            byDate.set(item.date, (byDate.get(item.date) ?? 0) + 1)
        }
        if (byDate.size === 0) return 0
        return Math.max(...Array.from(byDate.values()))
    })()
    const carnetGridColumns = shiftsPerDay > 1 ? shiftsPerDay : hasMultipleShifts ? shifts.length : 4

    return (
        <div className="min-h-screen bg-gray-50 py-6 sm:py-8 px-4 print-page">
            <div className="max-w-md mx-auto print-container">
                <Link
                    href="/mi-cuenta/entradas"
                    className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 print-hidden"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver
                </Link>

                <div className="ticket-container bg-white shadow-2xl rounded-2xl overflow-hidden">
                    {/* Ticket Header */}
                    <div className="bg-gradient-fdnda p-4 sm:p-6 text-white relative overflow-hidden">
                        <div className="ticket-pattern absolute inset-0 opacity-10" />
                        <div className="relative z-10 text-center">
                            <h2 className="font-bold text-lg sm:text-xl mb-2">{ticket.event.title}</h2>
                            <Badge className="bg-white/20 text-white border-0">
                                {ticket.ticketType.name}
                            </Badge>
                        </div>
                    </div>

                    {/* QR Section */}
                    <div className="bg-white p-5 sm:p-8 flex flex-col items-center justify-center border-b border-dashed border-gray-300 relative print-qr-section">
                        {/* Cutout circles */}
                        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full" />
                        <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full" />

                        {ticket.status === "ACTIVE" && membershipNotStarted ? (
                            <div className="flex w-full flex-col items-center justify-center gap-3 py-6 text-center">
                                <div className="flex h-44 w-44 sm:h-56 sm:w-56 flex-col items-center justify-center gap-2 rounded-xl bg-blue-50 px-4">
                                    <Calendar className="h-10 w-10 text-fdnda-secondary" />
                                    <span className="text-sm font-semibold text-fdnda-secondary">Tu membresía aún no inicia</span>
                                </div>
                                <p className="text-sm text-gray-600">
                                    Válido a partir del{" "}
                                    <span className="font-bold text-gray-900">
                                        {formatDate(ticket.membershipAttendance?.membershipStart ?? ticket.event.startDate)}
                                    </span>
                                </p>
                                <p className="text-xs text-gray-400">
                                    El carnet con tu código QR estará disponible desde esa fecha.
                                </p>
                            </div>
                        ) : ticket.status === "ACTIVE" && membershipFrozen ? (
                            <div className="flex w-full flex-col items-center justify-center gap-3 py-6 text-center">
                                <div className="flex h-44 w-44 sm:h-56 sm:w-56 flex-col items-center justify-center gap-2 rounded-xl bg-sky-50 px-4">
                                    <Snowflake className="h-10 w-10 text-sky-600" />
                                    <span className="text-sm font-semibold text-sky-700">Membresía congelada</span>
                                </div>
                                {currentFreeze && (
                                    <p className="text-sm text-gray-600">
                                        Congelada del{" "}
                                        <span className="font-bold text-gray-900">{formatDate(currentFreeze.start)}</span>{" "}
                                        al{" "}
                                        <span className="font-bold text-gray-900">
                                            {formatDate(previousDateKey(currentFreeze.end))}
                                        </span>
                                    </p>
                                )}
                                <p className="text-xs text-gray-400">
                                    El código QR se reactivará al finalizar el mes congelado.
                                </p>
                            </div>
                        ) : ticket.status === "ACTIVE" ? (
                            <>
                                <div className="bg-white p-2 rounded-xl shadow-inner mb-4">
                                    {ticket.qrDataUrl ? (
                                    <Image
                                        src={ticket.qrDataUrl}
                                        alt="Ticket QR"
                                        width={256}
                                        height={256}
                                        unoptimized
                                        className="w-44 h-44 sm:w-56 sm:h-56 object-contain print-qr"
                                    />
                                    ) : (
                                        <div className="w-44 h-44 sm:w-64 sm:h-64 flex items-center justify-center bg-gray-100 rounded-xl">
                                            <span className="text-gray-400 font-medium">QR no disponible</span>
                                        </div>
                                    )}
                                </div>
                                <p className="text-sm text-gray-500 text-center mb-2">
                                    Valido para: <span className="font-bold text-gray-900">{formatDate(ticket.qrDate)}</span>
                                </p>
                                {ticket.qrShift && (
                                    <p className="text-sm text-gray-500 text-center mb-2">
                                        Turno: <span className="font-bold text-gray-900">{shortShiftLabel(ticket.qrShift)}</span>
                                    </p>
                                )}
                                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                                    {usesPurchasedDate ? (
                                        <Calendar className="h-3 w-3" />
                                    ) : (
                                        <RefreshCw className="h-3 w-3" />
                                    )}
                                    {usesPurchasedDate
                                        ? "Codigo QR emitido para la fecha comprada"
                                        : "El codigo QR se actualiza diariamente"}
                                </div>
                            </>
                        ) : (
                            <div className="w-44 h-44 sm:w-64 sm:h-64 flex items-center justify-center bg-gray-100 rounded-xl mb-4">
                                <span className="text-gray-400 font-medium">Ticket Inactivo</span>
                            </div>
                        )}
                    </div>

                    {/* Details Section */}
                    <div className="bg-white p-4 sm:p-6 space-y-4">
                        <div className="flex items-start gap-3">
                            <User className="h-5 w-5 text-gray-400 mt-0.5" />
                            <div>
                                {ticket.order?.user?.name && (
                                    <>
                                        <div className="text-xs text-gray-500">Comprador</div>
                                        <div className="font-medium">{ticket.order.user.name}</div>
                                        <div className="mt-2 text-xs text-gray-500">Inscrito</div>
                                    </>
                                )}
                                <div className="text-xs text-gray-500">Asistente</div>
                                <div className="font-medium">{ticket.attendeeName}</div>
                                {ticket.attendeeDni && (
                                    <div className="text-sm text-gray-500">DNI: {ticket.attendeeDni}</div>
                                )}
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                            <div>
                                <div className="text-xs text-gray-500">
                                    {ticket.membershipAttendance?.membershipStart ? "Inicio de membresía" : "Fecha del Evento"}
                                </div>
                                <div className="font-medium">
                                    {formatDate(ticket.membershipAttendance?.membershipStart ?? ticket.event.startDate)}
                                </div>
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

                        {(() => {
                            const schedule =
                                ticket.monthlySchedule?.current ??
                                parseMembershipScheduleSelection(ticket.membershipSchedule)
                            if (!schedule) return null
                            const isMonthly = Boolean(ticket.monthlySchedule)
                            return (
                                <div className="flex items-start gap-3">
                                    <Clock className="h-5 w-5 text-gray-400 mt-0.5" />
                                    <div>
                                        <div className="text-xs text-gray-500">
                                            {isMonthly ? "Tu horario de este mes" : "Tu horario"}
                                        </div>
                                        <div className="font-medium">
                                            {schedule.categoryLabel ? `${schedule.categoryLabel} · ` : ""}
                                            {schedule.frequencyLabel}
                                        </div>
                                        <ul className="mt-1 space-y-0.5 text-sm text-gray-600">
                                            {schedule.groups.map((group) => (
                                                <li key={group.id}>
                                                    {group.label}: {formatSlotLabel({ start: group.start, end: group.end })}
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="mt-1 text-[11px] text-gray-400">
                                            {isMonthly
                                                ? "Puedes cambiar tu horario para el próximo mes abajo."
                                                : "Tu horario es fijo durante toda la membresía."}
                                        </p>
                                    </div>
                                </div>
                            )
                        })()}

                        {isMembership && ticket.membershipFreeze && (
                            <div className="rounded-xl border border-sky-100 bg-sky-50 p-4">
                                <div className="flex items-start gap-3">
                                    <Snowflake className="mt-0.5 h-5 w-5 text-sky-600" />
                                    <div className="flex-1 space-y-3">
                                        <div>
                                            <div className="text-sm font-semibold text-sky-900">
                                                Congelamiento de membresía
                                            </div>
                                            <p className="mt-1 text-xs text-sky-800">
                                                Puedes congelar una sola vez por membresía, por un mes calendario completo,
                                                con al menos 48 horas de anticipación. No es fraccionable, no es retroactivo
                                                y no aplica para enero o febrero porque esos meses ya extienden la vigencia.
                                            </p>
                                            {isVidenaMembership && (
                                                <p className="mt-2 text-xs text-sky-800">
                                                    En Videna, el congelamiento no debe coincidir con cierres por mantenimiento
                                                    ya en curso; coordina con administración si existe un aviso de cierre.
                                                </p>
                                            )}
                                        </div>

                                        {ticket.membershipFreeze.applied ? (
                                            <div className="rounded-lg bg-white/70 px-3 py-2 text-xs text-sky-900">
                                                <div className="font-semibold">
                                                    Congelamiento registrado: {formatMonthLabel(ticket.membershipFreeze.applied.month)}
                                                </div>
                                                <div>
                                                    Del {formatDate(ticket.membershipFreeze.applied.start)} al{" "}
                                                    {formatDate(previousDateKey(ticket.membershipFreeze.applied.end))}.
                                                </div>
                                            </div>
                                        ) : ticket.membershipFreeze.availableMonths.length > 0 ? (
                                            <div className="space-y-2">
                                                <label htmlFor="freezeMonth" className="block text-xs font-medium text-sky-900">
                                                    Mes a congelar
                                                </label>
                                                <div className="flex flex-col gap-2 sm:flex-row">
                                                    <select
                                                        id="freezeMonth"
                                                        value={freezeMonth}
                                                        onChange={(event) => setFreezeMonth(event.target.value)}
                                                        className="h-10 flex-1 rounded-md border border-sky-200 bg-white px-3 text-sm text-gray-900"
                                                    >
                                                        {ticket.membershipFreeze.availableMonths.map((option) => (
                                                            <option key={option.month} value={option.month}>
                                                                {formatMonthLabel(option.month)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <Button
                                                        type="button"
                                                        onClick={handleFreezeSubmit}
                                                        disabled={!freezeMonth || freezeSubmitting}
                                                        className="gap-2"
                                                    >
                                                        {freezeSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                                        Congelar
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-sky-800">
                                                No hay meses disponibles para congelar según la vigencia y la anticipación mínima.
                                            </p>
                                        )}

                                        {freezeMessage && <p className="text-xs font-medium text-emerald-700">{freezeMessage}</p>}
                                        {freezeError && <p className="text-xs font-medium text-red-600">{freezeError}</p>}
                                    </div>
                                </div>
                            </div>
                        )}

                        {ticket.status === "ACTIVE" && ticket.monthlySchedule?.next && (
                            <NextMonthScheduleEditor
                                ticketId={ticket.id}
                                profile={ticket.monthlySchedule.profile}
                                initial={ticket.monthlySchedule.next.input}
                                summary={ticket.monthlySchedule.next.summary}
                                nextMonthLabel={formatDate(ticket.monthlySchedule.next.monthStart, {
                                    dateStyle: "medium",
                                })}
                            />
                        )}

                        <div className="pt-4 mt-4 border-t">
                            <div className="flex justify-between items-center text-sm text-gray-500">
                                <span>Codigo:</span>
                                <span className="font-mono font-bold text-gray-700">{ticket.ticketCode}</span>
                            </div>
                        </div>
                    </div>

                    {/* Carnet Section */}
                    <div className="bg-white p-4 sm:p-6 border-t carnet-section print-carnet-section">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-base sm:text-lg font-semibold">
                                    {isEvento ? "Entrada valida" : "Carnet de asistencia"}
                                </h3>
                                <p className="text-sm text-gray-500">
                                    {usedDisplayCount}/{totalCount} {clasesLabel} usadas - {remainingCount} restantes
                                    {isMembership ? " este mes" : ""}
                                </p>
                                {isMembership && ticket.membershipAttendance?.membershipExpiry && (
                                    <div className="mt-1 space-y-0.5 text-xs text-gray-500">
                                        <p>
                                            Vigencia:{" "}
                                            {ticket.membershipAttendance.membershipStart
                                                ? formatDate(ticket.membershipAttendance.membershipStart, { dateStyle: "medium" })
                                                : "-"}{" "}
                                            al{" "}
                                            {formatDate(ticket.membershipAttendance.membershipExpiry, { dateStyle: "medium" })}
                                        </p>
                                        <p className="text-amber-600">
                                            No aplica en enero ni febrero; la vigencia se extiende esos meses.
                                        </p>
                                        {ticket.membershipFreeze?.applied && (
                                            <p className="text-sky-600">
                                                Congelamiento: {formatMonthLabel(ticket.membershipFreeze.applied.month)}; la vigencia se extendió un mes calendario.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                            <Badge variant="secondary" className="text-xs">
                                {remainingCount} restantes
                            </Badge>
                        </div>

                        {displayEntitlements.length > 0 ? (
                            <div
                                className="grid gap-2 print-carnet-grid"
                                style={{ gridTemplateColumns: `repeat(${carnetGridColumns}, minmax(0, 1fr))` }}
                            >
                                {displayEntitlements.map((entitlement, index) => (
                                    <div
                                        key={`${entitlement.date}-${entitlement.shiftLabel ?? ""}-${index}`}
                                        className={`rounded-md border px-2 py-2 text-center text-xs font-semibold carnet-card ${entitlement.status === "USED"
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                            : "border-gray-200 bg-gray-50 text-gray-700"
                                            }`}
                                    >
                                        {entitlement.shiftLabel ? (
                                            <>
                                                <div className="text-[10px] uppercase text-gray-400">{entitlement.shiftLabel}</div>
                                                <div className="text-sm">{entitlement.label}</div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="text-[10px] uppercase text-gray-400">{claseLabel}</div>
                                                <div className="text-sm">{index + 1}</div>
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-sm text-gray-500">
                                Este ticket no tiene {clasesLabel} registradas.
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-6 text-center print-hidden">
                    <Button variant="outline" className="w-full sm:w-auto gap-2" onClick={() => window.print()}>
                        <Download className="h-4 w-4" />
                        Descargar carnet
                    </Button>
                </div>
            </div>
        </div>
    )
}
