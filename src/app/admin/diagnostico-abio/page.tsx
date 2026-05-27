"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatPrice } from "@/lib/utils"
import {
    AlertTriangle,
    CheckCircle2,
    Clock,
    FileWarning,
    Loader2,
    Receipt,
    RefreshCw,
    Search,
} from "lucide-react"

type Status =
    | "PENDING"
    | "PROCESSING"
    | "ISSUED"
    | "FAILED"
    | "FAILED_RETRYABLE"
    | "FAILED_REQUIRES_REVIEW"

interface InvoiceRow {
    id: string
    orderId: string
    traceId: string | null
    invoiceNumber: string | null
    documentType: "BOLETA" | "FACTURA"
    status: Status
    indicator: string | null
    sucursalCode: string | null
    assignedTotal: number
    buyerName: string | null
    buyerDocType: string | null
    buyerDocNumber: string | null
    buyerEmail: string | null
    httpStatus: number | null
    lastError: string | null
    retryCount: number
    providerResponse: string | null
    pdfUrl: string | null
    sentToProvider: boolean
    sentAt: string | null
    issuedAt: string | null
    createdAt: string
    order: {
        id: string
        status: string
        totalAmount: number
        currency: string
        paidAt: string | null
        createdAt: string
        user: { id: string; name?: string | null; email?: string | null } | null
    } | null
}

interface SummaryRow {
    status: Status
    count: number
}

interface ApiResponse {
    success: boolean
    data?: {
        invoices: InvoiceRow[]
        summary7d: SummaryRow[]
        limit: number
    }
    error?: string
}

const STATUS_FILTERS: { value: "ALL" | "ONLY_PROBLEMS" | Status; label: string }[] = [
    { value: "ONLY_PROBLEMS", label: "Solo problemas" },
    { value: "ALL", label: "Todos" },
    { value: "ISSUED", label: "Emitidos OK" },
    { value: "PENDING", label: "Pendientes" },
    { value: "PROCESSING", label: "En proceso" },
    { value: "FAILED", label: "Fallidos" },
    { value: "FAILED_RETRYABLE", label: "Reintentables" },
    { value: "FAILED_REQUIRES_REVIEW", label: "Requieren revisión" },
]

function statusBadge(status: Status) {
    switch (status) {
        case "ISSUED":
            return (
                <Badge className="bg-green-100 text-green-700 border-green-200">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Emitido
                </Badge>
            )
        case "PROCESSING":
            return (
                <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    En proceso
                </Badge>
            )
        case "PENDING":
            return (
                <Badge className="bg-gray-100 text-gray-700 border-gray-200">
                    <Clock className="h-3 w-3 mr-1" />
                    Pendiente
                </Badge>
            )
        case "FAILED_RETRYABLE":
            return (
                <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Reintentando
                </Badge>
            )
        case "FAILED":
            return (
                <Badge className="bg-orange-100 text-orange-700 border-orange-200">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Fallido
                </Badge>
            )
        case "FAILED_REQUIRES_REVIEW":
            return (
                <Badge className="bg-red-100 text-red-700 border-red-200">
                    <FileWarning className="h-3 w-3 mr-1" />
                    Requiere revisión
                </Badge>
            )
        default:
            return <Badge variant="outline">{status}</Badge>
    }
}

function formatTimestamp(value: string | null) {
    if (!value) return "—"
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

function shortenId(id: string, length = 8) {
    return id.length <= length ? id : id.slice(-length)
}

export default function DiagnosticoAbioPage() {
    const [data, setData] = useState<ApiResponse["data"] | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>("")
    const [statusFilter, setStatusFilter] = useState<"ALL" | "ONLY_PROBLEMS" | Status>("ONLY_PROBLEMS")
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [expandedId, setExpandedId] = useState<string | null>(null)

    useEffect(() => {
        const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
        return () => clearTimeout(handle)
    }, [search])

    const fetchInvoices = useCallback(async () => {
        setLoading(true)
        setError("")
        try {
            const params = new URLSearchParams()
            if (statusFilter === "ONLY_PROBLEMS") {
                params.set("onlyProblems", "true")
            } else if (statusFilter !== "ALL") {
                params.set("status", statusFilter)
            }
            if (debouncedSearch) params.set("q", debouncedSearch)
            params.set("limit", "200")

            const response = await fetch(`/api/admin/abio-invoices?${params.toString()}`, {
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
    }, [statusFilter, debouncedSearch])

    useEffect(() => {
        fetchInvoices()
    }, [fetchInvoices])

    const summaryByStatus = useMemo(() => {
        const map = new Map<Status, number>()
        for (const row of data?.summary7d ?? []) {
            map.set(row.status, row.count)
        }
        return map
    }, [data?.summary7d])

    const summaryCards: { status: Status; label: string; icon: React.ElementType; tone: string }[] = [
        { status: "ISSUED", label: "Emitidos OK", icon: CheckCircle2, tone: "text-green-600 bg-green-100" },
        { status: "FAILED_RETRYABLE", label: "Reintentando", icon: RefreshCw, tone: "text-amber-600 bg-amber-100" },
        { status: "FAILED_REQUIRES_REVIEW", label: "Requieren revisión", icon: FileWarning, tone: "text-red-600 bg-red-100" },
        { status: "PENDING", label: "Pendientes envío", icon: Clock, tone: "text-gray-600 bg-gray-100" },
    ]

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Receipt className="h-6 w-6" />
                        Diagnóstico de comprobantes ABIO
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Cada comprobante (boleta/factura) enviado a Servilex/ABIO con su estado, error y respuesta del proveedor.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchInvoices} disabled={loading} className="gap-2">
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    Actualizar
                </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {summaryCards.map(({ status, label, icon: Icon, tone }) => (
                    <Card key={status}>
                        <CardContent className="p-4">
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${tone}`}>
                                    <Icon className="h-5 w-5" />
                                </div>
                                <div>
                                    <p className="text-2xl font-bold">{summaryByStatus.get(status) ?? 0}</p>
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
                        <CardTitle>Comprobantes recientes</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Buscar por orderId, email, DNI, traceId, # boleta..."
                                    className="pl-9 w-80"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-3">
                        {STATUS_FILTERS.map((filter) => (
                            <Button
                                key={filter.value}
                                size="sm"
                                variant={statusFilter === filter.value ? "default" : "outline"}
                                onClick={() => setStatusFilter(filter.value)}
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
                    ) : !data?.invoices.length ? (
                        <div className="text-center py-12 text-gray-500">
                            <Receipt className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p className="font-medium">No hay comprobantes para mostrar</p>
                            <p className="text-sm text-gray-400 mt-1">
                                {statusFilter === "ONLY_PROBLEMS"
                                    ? "Todo bien — todos los comprobantes se están emitiendo correctamente."
                                    : "Ajusta los filtros o la búsqueda para ver más registros."}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-xs uppercase text-gray-500">
                                        <th className="pb-2 font-medium">Fecha</th>
                                        <th className="pb-2 font-medium">Estado</th>
                                        <th className="pb-2 font-medium">Doc / Nº</th>
                                        <th className="pb-2 font-medium">Comprador</th>
                                        <th className="pb-2 font-medium text-right">Monto</th>
                                        <th className="pb-2 font-medium">Order / Trace</th>
                                        <th className="pb-2 font-medium">Detalle</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.invoices.map((inv) => {
                                        const isExpanded = expandedId === inv.id
                                        return (
                                            <Fragment key={inv.id}>
                                                <tr className="border-b align-top hover:bg-gray-50">
                                                    <td className="py-3 whitespace-nowrap text-gray-700 text-xs">
                                                        <div>{formatTimestamp(inv.createdAt)}</div>
                                                        {inv.sentAt && (
                                                            <div className="text-gray-400 mt-1">
                                                                Enviado: {formatTimestamp(inv.sentAt)}
                                                            </div>
                                                        )}
                                                        {inv.issuedAt && (
                                                            <div className="text-green-600 mt-1">
                                                                Emitido: {formatTimestamp(inv.issuedAt)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-3">
                                                        <div className="space-y-1">
                                                            {statusBadge(inv.status)}
                                                            {inv.retryCount > 0 && (
                                                                <div className="text-[10px] text-gray-500">
                                                                    Reintentos: {inv.retryCount}
                                                                </div>
                                                            )}
                                                            {inv.httpStatus && (
                                                                <div className="text-[10px] text-gray-500">
                                                                    HTTP: {inv.httpStatus}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-3">
                                                        <div className="space-y-0.5">
                                                            <Badge variant="outline" className="text-[10px]">
                                                                {inv.documentType}
                                                            </Badge>
                                                            {inv.invoiceNumber && (
                                                                <div className="font-mono text-xs text-gray-700">
                                                                    {inv.invoiceNumber}
                                                                </div>
                                                            )}
                                                            {inv.indicator && (
                                                                <div className="text-[10px] text-gray-500">
                                                                    {inv.indicator}
                                                                    {inv.sucursalCode ? ` · Suc ${inv.sucursalCode}` : ""}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-3">
                                                        <div className="space-y-0.5">
                                                            {inv.buyerName && (
                                                                <div className="text-gray-800">{inv.buyerName}</div>
                                                            )}
                                                            {inv.buyerDocNumber && (
                                                                <div className="text-xs text-gray-500 font-mono">
                                                                    {inv.buyerDocType === "6" ? "RUC" : "DNI"}: {inv.buyerDocNumber}
                                                                </div>
                                                            )}
                                                            {(inv.buyerEmail || inv.order?.user?.email) && (
                                                                <div className="text-xs text-gray-500">
                                                                    {inv.buyerEmail || inv.order?.user?.email}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="py-3 text-right">
                                                        <div className="font-semibold text-gray-800">
                                                            {formatPrice(inv.assignedTotal, inv.order?.currency)}
                                                        </div>
                                                        {inv.order && inv.assignedTotal !== inv.order.totalAmount && (
                                                            <div className="text-[10px] text-gray-400">
                                                                Order: {formatPrice(inv.order.totalAmount, inv.order.currency)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-3 text-xs text-gray-600">
                                                        <div className="font-mono">{shortenId(inv.orderId)}</div>
                                                        {inv.traceId && (
                                                            <div className="font-mono text-gray-400 mt-1">
                                                                trace: {shortenId(inv.traceId, 12)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="py-3 max-w-md">
                                                        {inv.lastError ? (
                                                            <div className="text-xs text-red-700 break-words">
                                                                {inv.lastError}
                                                            </div>
                                                        ) : inv.status === "ISSUED" ? (
                                                            <div className="text-xs text-green-700">
                                                                Comprobante emitido correctamente
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400 text-xs">—</span>
                                                        )}
                                                        <div className="mt-1 flex gap-2 text-xs">
                                                            {inv.pdfUrl && (
                                                                <a
                                                                    href={inv.pdfUrl}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                    className="text-blue-600 hover:underline"
                                                                >
                                                                    Ver PDF
                                                                </a>
                                                            )}
                                                            {inv.providerResponse && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setExpandedId(isExpanded ? null : inv.id)
                                                                    }
                                                                    className="text-gray-600 hover:underline"
                                                                >
                                                                    {isExpanded ? "Ocultar" : "Ver"} respuesta
                                                                </button>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && inv.providerResponse && (
                                                    <tr className="border-b bg-gray-50">
                                                        <td colSpan={7} className="px-3 py-2">
                                                            <div className="text-[11px] font-semibold text-gray-500 mb-1">
                                                                Respuesta del proveedor (truncada a 2KB):
                                                            </div>
                                                            <pre className="text-[11px] text-gray-700 whitespace-pre-wrap break-words bg-white p-2 rounded border">
                                                                {inv.providerResponse}
                                                            </pre>
                                                        </td>
                                                    </tr>
                                                )}
                                            </Fragment>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
