"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    AlertTriangle,
    CheckCircle2,
    Loader2,
    QrCode,
    RefreshCw,
    Search,
    ShieldOff,
    XCircle,
} from "lucide-react"

type Outcome =
    | "OK"
    | "NO_ENTITLEMENT"
    | "TICKET_NOT_ACTIVE"
    | "TICKET_NOT_FOUND"
    | "UNAUTHORIZED"
    | "QR_GENERATION_ERROR"
    | "INTERNAL_ERROR"

interface LogRow {
    id: string
    outcome: Outcome
    reason: string | null
    qrDate: string | null
    qrShift: string | null
    requestedDate: string | null
    userAgent: string | null
    ipAddress: string | null
    createdAt: string
    ticket: { id: string; ticketCode?: string; attendeeName?: string | null; status?: string } | null
    user: { id: string; name?: string; email?: string } | null
    event: { id: string; title?: string } | null
}

interface SummaryRow {
    outcome: Outcome
    count: number
}

interface ApiResponse {
    success: boolean
    data?: {
        logs: LogRow[]
        summary7d: SummaryRow[]
        limit: number
    }
    error?: string
}

const OUTCOME_FILTERS: { value: "ALL" | "ONLY_PROBLEMS" | Outcome; label: string }[] = [
    { value: "ONLY_PROBLEMS", label: "Solo problemas" },
    { value: "ALL", label: "Todos" },
    { value: "OK", label: "OK" },
    { value: "NO_ENTITLEMENT", label: "Sin entitlement" },
    { value: "TICKET_NOT_ACTIVE", label: "Ticket no activo" },
    { value: "TICKET_NOT_FOUND", label: "Ticket no encontrado" },
    { value: "QR_GENERATION_ERROR", label: "Error al generar QR" },
    { value: "INTERNAL_ERROR", label: "Error interno" },
    { value: "UNAUTHORIZED", label: "No autorizado" },
]

function outcomeBadge(outcome: Outcome) {
    switch (outcome) {
        case "OK":
            return (
                <Badge className="bg-green-100 text-green-700 border-green-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    OK
                </Badge>
            )
        case "NO_ENTITLEMENT":
            return (
                <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Sin entitlement
                </Badge>
            )
        case "TICKET_NOT_ACTIVE":
            return (
                <Badge className="bg-orange-100 text-orange-700 border-orange-200">
                    <ShieldOff className="h-3 w-3 mr-1" />
                    Ticket no activo
                </Badge>
            )
        case "TICKET_NOT_FOUND":
            return (
                <Badge className="bg-purple-100 text-purple-700 border-purple-200">
                    <XCircle className="h-3 w-3 mr-1" />
                    Ticket no encontrado
                </Badge>
            )
        case "QR_GENERATION_ERROR":
            return (
                <Badge className="bg-red-100 text-red-700 border-red-200">
                    <XCircle className="h-3 w-3 mr-1" />
                    Error QR
                </Badge>
            )
        case "INTERNAL_ERROR":
            return (
                <Badge className="bg-red-100 text-red-700 border-red-200">
                    <XCircle className="h-3 w-3 mr-1" />
                    Error interno
                </Badge>
            )
        case "UNAUTHORIZED":
            return (
                <Badge className="bg-gray-100 text-gray-700 border-gray-200">
                    <ShieldOff className="h-3 w-3 mr-1" />
                    No autorizado
                </Badge>
            )
        default:
            return <Badge variant="outline">{outcome}</Badge>
    }
}

function formatTimestamp(value: string) {
    try {
        return new Date(value).toLocaleString("es-PE", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZone: "America/Lima",
        })
    } catch {
        return value
    }
}

export default function DiagnosticoQrPage() {
    const [data, setData] = useState<ApiResponse["data"] | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>("")
    const [outcomeFilter, setOutcomeFilter] = useState<"ALL" | "ONLY_PROBLEMS" | Outcome>("ONLY_PROBLEMS")
    const [search, setSearch] = useState("")

    const fetchLogs = useCallback(async () => {
        setLoading(true)
        setError("")
        try {
            const params = new URLSearchParams()
            if (outcomeFilter === "ONLY_PROBLEMS") {
                params.set("onlyProblems", "true")
            } else if (outcomeFilter !== "ALL") {
                params.set("outcome", outcomeFilter)
            }
            params.set("limit", "200")

            const response = await fetch(`/api/admin/ticket-issuance-logs?${params.toString()}`, {
                cache: "no-store",
            })
            const json = (await response.json()) as ApiResponse
            if (!response.ok || !json.success) {
                throw new Error(json.error || "No se pudo cargar el log")
            }
            setData(json.data ?? null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error desconocido")
        } finally {
            setLoading(false)
        }
    }, [outcomeFilter])

    useEffect(() => {
        fetchLogs()
    }, [fetchLogs])

    const filteredLogs = useMemo(() => {
        if (!data?.logs) return []
        if (!search.trim()) return data.logs
        const q = search.trim().toLowerCase()
        return data.logs.filter((log) => {
            return (
                log.ticket?.ticketCode?.toLowerCase().includes(q) ||
                log.ticket?.id?.toLowerCase().includes(q) ||
                log.user?.email?.toLowerCase().includes(q) ||
                log.user?.name?.toLowerCase().includes(q) ||
                log.event?.title?.toLowerCase().includes(q) ||
                log.reason?.toLowerCase().includes(q)
            )
        })
    }, [data?.logs, search])

    const summaryByOutcome = useMemo(() => {
        const map = new Map<Outcome, number>()
        for (const row of data?.summary7d ?? []) {
            map.set(row.outcome, row.count)
        }
        return map
    }, [data?.summary7d])

    const summaryCards: { outcome: Outcome; label: string; icon: React.ElementType; tone: string }[] = [
        { outcome: "OK", label: "QR emitidos OK", icon: CheckCircle2, tone: "text-green-600 bg-green-100" },
        { outcome: "NO_ENTITLEMENT", label: "Sin entitlement", icon: AlertTriangle, tone: "text-amber-600 bg-amber-100" },
        { outcome: "QR_GENERATION_ERROR", label: "Errores al generar QR", icon: XCircle, tone: "text-red-600 bg-red-100" },
        { outcome: "INTERNAL_ERROR", label: "Errores internos", icon: XCircle, tone: "text-red-600 bg-red-100" },
    ]

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <QrCode className="h-6 w-6" />
                        Diagnóstico de emisión de QR
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Registro de cada solicitud de QR del usuario y la causa cuando no se pudo emitir.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchLogs} disabled={loading} className="gap-2">
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    Actualizar
                </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {summaryCards.map(({ outcome, label, icon: Icon, tone }) => (
                    <Card key={outcome}>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${tone}`}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold">{summaryByOutcome.get(outcome) ?? 0}</p>
                                    <p className="text-xs text-gray-500">{label} (7d)</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <CardTitle>Eventos recientes</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Buscar por código, email, evento o causa..."
                                    className="pl-9 w-72"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-3">
                        {OUTCOME_FILTERS.map((filter) => (
                            <Button
                                key={filter.value}
                                size="sm"
                                variant={outcomeFilter === filter.value ? "default" : "outline"}
                                onClick={() => setOutcomeFilter(filter.value)}
                            >
                                {filter.label}
                            </Button>
                        ))}
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                        </div>
                    ) : error ? (
                        <div className="text-center py-12 text-red-600">{error}</div>
                    ) : filteredLogs.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <QrCode className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p className="font-medium">No hay eventos para mostrar</p>
                            <p className="text-sm text-gray-400 mt-1">
                                {outcomeFilter === "ONLY_PROBLEMS"
                                    ? "Nada que reportar — todos los QR se están emitiendo correctamente."
                                    : "Ajusta los filtros para ver más registros."}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-xs uppercase text-gray-500">
                                        <th className="pb-2 font-medium">Fecha/hora</th>
                                        <th className="pb-2 font-medium">Resultado</th>
                                        <th className="pb-2 font-medium">Ticket / Asistente</th>
                                        <th className="pb-2 font-medium">Usuario</th>
                                        <th className="pb-2 font-medium">Evento</th>
                                        <th className="pb-2 font-medium">QR / Fecha pedida</th>
                                        <th className="pb-2 font-medium">Detalle</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredLogs.map((log) => (
                                        <tr key={log.id} className="border-b align-top">
                                            <td className="py-3 whitespace-nowrap text-gray-700">
                                                {formatTimestamp(log.createdAt)}
                                            </td>
                                            <td className="py-3">{outcomeBadge(log.outcome)}</td>
                                            <td className="py-3">
                                                {log.ticket ? (
                                                    <div className="space-y-0.5">
                                                        <div className="font-mono text-xs text-gray-600">
                                                            {log.ticket.ticketCode ?? log.ticket.id}
                                                        </div>
                                                        {log.ticket.attendeeName && (
                                                            <div className="text-gray-800">{log.ticket.attendeeName}</div>
                                                        )}
                                                        {log.ticket.status && log.ticket.status !== "ACTIVE" && (
                                                            <Badge variant="outline" className="text-[10px]">
                                                                {log.ticket.status}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="py-3">
                                                {log.user ? (
                                                    <div className="space-y-0.5">
                                                        {log.user.name && <div className="text-gray-800">{log.user.name}</div>}
                                                        {log.user.email && (
                                                            <div className="text-xs text-gray-500">{log.user.email}</div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="py-3">
                                                {log.event?.title ? (
                                                    <span className="text-gray-700">{log.event.title}</span>
                                                ) : (
                                                    <span className="text-gray-400">—</span>
                                                )}
                                            </td>
                                            <td className="py-3 text-xs text-gray-600">
                                                {log.qrDate && <div>QR: {log.qrDate}</div>}
                                                {log.qrShift && <div>Turno: {log.qrShift}</div>}
                                                {log.requestedDate && log.requestedDate !== log.qrDate && (
                                                    <div className="text-gray-400">Pedido: {log.requestedDate}</div>
                                                )}
                                            </td>
                                            <td className="py-3 max-w-md">
                                                <div className="text-xs text-gray-700 whitespace-pre-wrap break-words">
                                                    {log.reason || "—"}
                                                </div>
                                                {log.ticket?.id && log.outcome !== "OK" && (
                                                    <Link
                                                        href={`/mi-cuenta/entradas/${log.ticket.id}`}
                                                        className="inline-block mt-1 text-xs text-blue-600 hover:underline"
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        Ver entrada del usuario
                                                    </Link>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
