"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import { ArrowLeft, Calendar, MapPin, User, Download, Loader2, RefreshCw } from "lucide-react"
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
    }
    ticketType: {
        name: string
        isPackage?: boolean
        packageDaysCount?: number | null
        validDays?: string[] | null
    }
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
    qrDataUrl: string
    qrDate: string
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

export default function TicketDetailPage() {
    const params = useParams()
    const [ticket, setTicket] = useState<TicketDetail | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")

    useEffect(() => {
        const fetchTicket = async () => {
            try {
                const response = await fetch(`/api/tickets/${params.ticketId}`, { cache: "no-store" })
                if (!response.ok) {
                    throw new Error("Error al cargar el ticket")
                }
                const data = await response.json()
                setTicket(data.data)
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

    const entitlements = ticket.entitlements || []
    const classCount = extractClassCount(ticket.ticketType.name)
    const isPackageLike = Boolean(
        ticket.ticketType.isPackage || ticket.ticketType.packageDaysCount || classCount
    )
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
    const totalCount = isPackageLike
        ? (ticket.ticketType.packageDaysCount ?? classCount ?? 0)
        : (scheduleDays.length > 0 ? scheduleDays.length : entitlements.length)
    const displayEntitlements = isPackageLike
        ? Array.from({ length: totalCount }, (_, index) => ({
            date: `slot-${index + 1}`,
            status: index < effectiveUsedCount ? ("USED" as const) : ("AVAILABLE" as const),
            usedAt: null,
        }))
        : (scheduleDays.length > 0
            ? scheduleDays.map((date) => {
                const key = formatDateKey(date)
                const existing = entitlementMap.get(key)
                return {
                    date: date.toISOString(),
                    status: existing?.status ?? ("AVAILABLE" as const),
                    usedAt: existing?.usedAt ?? null,
                }
            })
            : entitlements)
    const usedDisplayCount = isPackageLike
        ? effectiveUsedCount
        : displayEntitlements.filter((item) => item.status === "USED").length
    const remainingCount = Math.max(totalCount - usedDisplayCount, 0)

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4 print-page">
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
                    <div className="bg-gradient-fdnda p-6 text-white relative overflow-hidden">
                        <div className="ticket-pattern absolute inset-0 opacity-10" />
                        <div className="relative z-10 text-center">
                            <h2 className="font-bold text-xl mb-2">{ticket.event.title}</h2>
                            <Badge className="bg-white/20 text-white border-0">
                                {ticket.ticketType.name}
                            </Badge>
                        </div>
                    </div>

                    {/* QR Section */}
                    <div className="bg-white p-8 flex flex-col items-center justify-center border-b border-dashed border-gray-300 relative print-qr-section">
                        {/* Cutout circles */}
                        <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full" />
                        <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-gray-50 rounded-full" />

                        {ticket.status === "ACTIVE" ? (
                            <>
                                <div className="bg-white p-2 rounded-xl shadow-inner mb-4">
                                    {ticket.qrDataUrl ? (
                                    <Image
                                        src={ticket.qrDataUrl}
                                        alt="Ticket QR"
                                        width={256}
                                        height={256}
                                        unoptimized
                                        className="w-56 h-56 object-contain print-qr"
                                    />
                                    ) : (
                                        <div className="w-64 h-64 flex items-center justify-center bg-gray-100 rounded-xl">
                                            <span className="text-gray-400 font-medium">QR no disponible</span>
                                        </div>
                                    )}
                                </div>
                                <p className="text-sm text-gray-500 text-center mb-2">
                                    Válido para: <span className="font-bold text-gray-900">{formatDate(ticket.qrDate)}</span>
                                </p>
                                <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
                                    <RefreshCw className="h-3 w-3" />
                                    El código QR se actualiza diariamente
                                </div>
                            </>
                        ) : (
                            <div className="w-64 h-64 flex items-center justify-center bg-gray-100 rounded-xl mb-4">
                                <span className="text-gray-400 font-medium">Ticket Inactivo</span>
                            </div>
                        )}
                    </div>

                    {/* Details Section */}
                    <div className="bg-white p-6 space-y-4">
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
                                <div className="text-xs text-gray-500">Fecha del Evento</div>
                                <div className="font-medium">{formatDate(ticket.event.startDate)}</div>
                            </div>
                        </div>

                        <div className="flex items-start gap-3">
                            <MapPin className="h-5 w-5 text-gray-400 mt-0.5" />
                            <div>
                                <div className="text-xs text-gray-500">Ubicación</div>
                                <div className="font-medium">{ticket.event.venue}</div>
                                <div className="text-sm text-gray-500">{ticket.event.location}</div>
                            </div>
                        </div>

                        <div className="pt-4 mt-4 border-t">
                            <div className="flex justify-between items-center text-sm text-gray-500">
                                <span>Código:</span>
                                <span className="font-mono font-bold text-gray-700">{ticket.ticketCode}</span>
                            </div>
                        </div>
                    </div>

                    {/* Carnet Section */}
                    <div className="bg-white p-6 border-t carnet-section print-carnet-section">
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="text-lg font-semibold">Carnet de asistencia</h3>
                                <p className="text-sm text-gray-500">
                                    {usedDisplayCount}/{totalCount} clases usadas · {remainingCount} restantes
                                </p>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                                {remainingCount} restantes
                            </Badge>
                        </div>

                        {displayEntitlements.length > 0 ? (
                            <div className="grid grid-cols-4 gap-2 print-carnet-grid">
                                {displayEntitlements.map((entitlement, index) => (
                                    <div
                                        key={`${entitlement.date}-${index}`}
                                        className={`rounded-md border px-2 py-2 text-center text-xs font-semibold carnet-card ${entitlement.status === "USED"
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                            : "border-gray-200 bg-gray-50 text-gray-700"
                                            }`}
                                    >
                                        <div className="text-[10px] uppercase text-gray-400">Clase</div>
                                        <div className="text-sm">{index + 1}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-sm text-gray-500">
                                Este ticket no tiene clases registradas.
                            </div>
                        )}
                    </div>
                </div>

                <div className="mt-6 text-center print-hidden">
                    <Button variant="outline" className="gap-2" onClick={() => window.print()}>
                        <Download className="h-4 w-4" />
                        Descargar carnet
                    </Button>
                </div>
            </div>
        </div>
    )
}
