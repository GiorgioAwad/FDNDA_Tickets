"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, Loader2, Mail, Phone, RefreshCw, Search } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatDateTime, formatPrice } from "@/lib/utils"

type ComplaintStatus = "RECEIVED" | "IN_REVIEW" | "RESPONDED" | "CLOSED"
type ComplaintType = "RECLAMO" | "QUEJA"
type ComplaintSubjectType = "PRODUCTO" | "SERVICIO"

type ComplaintSummary = {
    id: string
    ticketNumber: string
    type: ComplaintType
    status: ComplaintStatus
    customerName: string
    email: string
    eventName: string | null
    orderId: string | null
    subjectDescription: string
    createdAt: string
    respondedAt: string | null
}

type ComplaintDetail = ComplaintSummary & {
    subjectType: ComplaintSubjectType
    consumerIsMinor: boolean
    parentName: string | null
    documentType: string
    documentNumber: string
    phone: string | null
    address: string
    amountClaimed: string | number | null
    detail: string
    requestDetail: string
    responseDetail: string | null
    emailAcknowledgedAt: string | null
    updatedAt: string
    user: {
        id: string
        name: string | null
        email: string
    } | null
}

type ComplaintStats = {
    total: number
    received: number
    inReview: number
    responded: number
    closed: number
}

const STATUS_OPTIONS: Array<{ value: "ALL" | ComplaintStatus; label: string }> = [
    { value: "ALL", label: "Todos" },
    { value: "RECEIVED", label: "Recibidos" },
    { value: "IN_REVIEW", label: "En revision" },
    { value: "RESPONDED", label: "Respondidos" },
    { value: "CLOSED", label: "Cerrados" },
]

function getStatusLabel(status: ComplaintStatus) {
    switch (status) {
        case "RECEIVED":
            return "Recibido"
        case "IN_REVIEW":
            return "En revision"
        case "RESPONDED":
            return "Respondido"
        case "CLOSED":
            return "Cerrado"
        default:
            return status
    }
}

function getStatusVariant(status: ComplaintStatus): "warning" | "info" | "success" | "secondary" {
    switch (status) {
        case "RECEIVED":
            return "warning"
        case "IN_REVIEW":
            return "info"
        case "RESPONDED":
            return "success"
        case "CLOSED":
            return "secondary"
        default:
            return "secondary"
    }
}

function getTypeVariant(type: ComplaintType): "destructive" | "outline" {
    return type === "RECLAMO" ? "destructive" : "outline"
}

export function InternalComplaintDesk({
    scopeLabel,
}: {
    scopeLabel: string
}) {
    const [loading, setLoading] = useState(true)
    const [entries, setEntries] = useState<ComplaintSummary[]>([])
    const [stats, setStats] = useState<ComplaintStats>({
        total: 0,
        received: 0,
        inReview: 0,
        responded: 0,
        closed: 0,
    })
    const [statusFilter, setStatusFilter] = useState<"ALL" | ComplaintStatus>("ALL")
    const [searchInput, setSearchInput] = useState("")
    const [query, setQuery] = useState("")
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [detail, setDetail] = useState<ComplaintDetail | null>(null)
    const [detailLoading, setDetailLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [responseDetail, setResponseDetail] = useState("")
    const [nextStatus, setNextStatus] = useState<ComplaintStatus>("IN_REVIEW")
    const [feedback, setFeedback] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const selectedEntry = useMemo(
        () => entries.find((entry) => entry.id === selectedId) || null,
        [entries, selectedId]
    )

    async function loadEntries(preserveSelection = true) {
        try {
            setLoading(true)
            setError(null)
            const params = new URLSearchParams({
                page: "1",
                pageSize: "50",
            })

            if (statusFilter !== "ALL") {
                params.set("status", statusFilter)
            }

            if (query.trim()) {
                params.set("query", query.trim())
            }

            const response = await fetch(`/api/admin/complaints?${params.toString()}`)
            const result = await response.json()

            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo cargar la bandeja.")
            }

            const nextEntries = result.data.entries as ComplaintSummary[]
            setEntries(nextEntries)
            setStats(result.data.stats as ComplaintStats)

            if (!preserveSelection) {
                setSelectedId(nextEntries[0]?.id || null)
                return
            }

            if (!selectedId && nextEntries[0]?.id) {
                setSelectedId(nextEntries[0].id)
                return
            }

            if (selectedId && !nextEntries.some((entry) => entry.id === selectedId)) {
                setSelectedId(nextEntries[0]?.id || null)
            }
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la bandeja.")
        } finally {
            setLoading(false)
        }
    }

    async function loadDetail(id: string) {
        try {
            setDetailLoading(true)
            setError(null)
            const response = await fetch(`/api/admin/complaints/${id}`)
            const result = await response.json()

            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo cargar el detalle.")
            }

            const nextDetail = result.data as ComplaintDetail
            setDetail(nextDetail)
            setResponseDetail(nextDetail.responseDetail || "")
            setNextStatus(nextDetail.status)
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el detalle.")
            setDetail(null)
        } finally {
            setDetailLoading(false)
        }
    }

    useEffect(() => {
        void loadEntries()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, query])

    useEffect(() => {
        if (!selectedId) {
            setDetail(null)
            return
        }

        void loadDetail(selectedId)
    }, [selectedId])

    async function handleSave() {
        if (!detail) return

        try {
            setSaving(true)
            setFeedback(null)
            setError(null)

            const response = await fetch(`/api/admin/complaints/${detail.id}`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    status: nextStatus,
                    responseDetail,
                }),
            })

            const result = await response.json()

            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo guardar la actualizacion.")
            }

            setFeedback("Reclamo actualizado correctamente.")
            await loadEntries()
            await loadDetail(detail.id)
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la actualizacion.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">Libro de Reclamaciones</h2>
                    <p className="text-sm text-gray-500">
                        {scopeLabel}: revisa, clasifica y responde los reclamos y quejas registrados en la web.
                    </p>
                </div>
                <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                        void loadEntries(false)
                    }}
                >
                    <RefreshCw className="h-4 w-4" />
                    Actualizar
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                <Card>
                    <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Total</p>
                        <p className="mt-2 text-2xl font-bold text-gray-900">{stats.total}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Recibidos</p>
                        <p className="mt-2 text-2xl font-bold text-amber-600">{stats.received}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">En revision</p>
                        <p className="mt-2 text-2xl font-bold text-blue-600">{stats.inReview}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Respondidos</p>
                        <p className="mt-2 text-2xl font-bold text-green-600">{stats.responded}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <p className="text-xs uppercase tracking-wide text-gray-500">Cerrados</p>
                        <p className="mt-2 text-2xl font-bold text-gray-700">{stats.closed}</p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <Input
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            placeholder="Buscar por ticket, cliente, documento, email, pedido o evento"
                            className="pl-9"
                        />
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(event) => setStatusFilter(event.target.value as "ALL" | ComplaintStatus)}
                        className="h-10 rounded-md border border-gray-300 px-3 text-sm"
                    >
                        {STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                    <Button onClick={() => setQuery(searchInput)}>Buscar</Button>
                </CardContent>
            </Card>

            {(error || feedback) && (
                <div className="space-y-3">
                    {error && (
                        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    {feedback && (
                        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                            {feedback}
                        </div>
                    )}
                </div>
            )}

            <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
                <Card className="min-h-[540px]">
                    <CardHeader>
                        <CardTitle className="text-lg">Bandeja</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {loading ? (
                            <div className="flex min-h-[320px] items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                            </div>
                        ) : entries.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                                No hay registros con los filtros aplicados.
                            </div>
                        ) : (
                            entries.map((entry) => {
                                const isSelected = entry.id === selectedId

                                return (
                                    <button
                                        key={entry.id}
                                        type="button"
                                        onClick={() => setSelectedId(entry.id)}
                                        className={`w-full rounded-xl border p-4 text-left transition ${
                                            isSelected
                                                ? "border-emerald-300 bg-emerald-50"
                                                : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                                        }`}
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant={getTypeVariant(entry.type)}>
                                                {entry.type === "RECLAMO" ? "Reclamo" : "Queja"}
                                            </Badge>
                                            <Badge variant={getStatusVariant(entry.status)}>
                                                {getStatusLabel(entry.status)}
                                            </Badge>
                                        </div>

                                        <div className="mt-3 flex items-start justify-between gap-3">
                                            <div>
                                                <p className="font-semibold text-gray-900">{entry.customerName}</p>
                                                <p className="text-xs text-gray-500">{entry.ticketNumber}</p>
                                            </div>
                                            <p className="text-xs text-gray-500">{formatDateTime(entry.createdAt)}</p>
                                        </div>

                                        <p className="mt-3 line-clamp-2 text-sm text-gray-700">
                                            {entry.subjectDescription}
                                        </p>

                                        <div className="mt-3 space-y-1 text-xs text-gray-500">
                                            {entry.eventName && <p>Evento: {entry.eventName}</p>}
                                            {entry.orderId && <p>Pedido: {entry.orderId}</p>}
                                            <p>{entry.email}</p>
                                        </div>
                                    </button>
                                )
                            })
                        )}
                    </CardContent>
                </Card>

                <Card className="min-h-[540px]">
                    <CardHeader>
                        <CardTitle className="text-lg">Detalle del registro</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {detailLoading ? (
                            <div className="flex min-h-[320px] items-center justify-center">
                                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                            </div>
                        ) : !detail || !selectedEntry ? (
                            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-10 text-center text-sm text-gray-500">
                                Selecciona un reclamo para ver su detalle.
                            </div>
                        ) : (
                            <div className="space-y-6">
                                <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="space-y-2">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant={getTypeVariant(detail.type)}>
                                                {detail.type === "RECLAMO" ? "Reclamo" : "Queja"}
                                            </Badge>
                                            <Badge variant={getStatusVariant(detail.status)}>
                                                {getStatusLabel(detail.status)}
                                            </Badge>
                                        </div>
                                        <div>
                                            <h3 className="text-xl font-semibold text-gray-900">{detail.ticketNumber}</h3>
                                            <p className="text-sm text-gray-500">{detail.subjectDescription}</p>
                                        </div>
                                    </div>
                                    <div className="text-sm text-gray-500">
                                        <p>Creado: {formatDateTime(detail.createdAt)}</p>
                                        {detail.respondedAt && <p>Respondido: {formatDateTime(detail.respondedAt)}</p>}
                                    </div>
                                </div>

                                <div className="grid gap-4 md:grid-cols-2">
                                    <div className="rounded-lg border bg-gray-50 p-4">
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Consumidor</p>
                                        <p className="mt-2 font-semibold text-gray-900">{detail.customerName}</p>
                                        <p className="mt-1 text-sm text-gray-600">
                                            {detail.documentType}: {detail.documentNumber}
                                        </p>
                                        <p className="mt-2 flex items-center gap-2 text-sm text-gray-600">
                                            <Mail className="h-4 w-4" />
                                            {detail.email}
                                        </p>
                                        {detail.phone && (
                                            <p className="mt-1 flex items-center gap-2 text-sm text-gray-600">
                                                <Phone className="h-4 w-4" />
                                                {detail.phone}
                                            </p>
                                        )}
                                        <p className="mt-2 text-sm text-gray-600">{detail.address}</p>
                                        {detail.consumerIsMinor && detail.parentName && (
                                            <p className="mt-2 text-sm text-gray-600">
                                                Menor de edad. Apoderado: {detail.parentName}
                                            </p>
                                        )}
                                    </div>

                                    <div className="rounded-lg border bg-gray-50 p-4">
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Operacion</p>
                                        <div className="mt-2 space-y-2 text-sm text-gray-600">
                                            <p>
                                                Tipo de bien:{" "}
                                                <span className="font-medium text-gray-900">
                                                    {detail.subjectType === "PRODUCTO" ? "Producto" : "Servicio"}
                                                </span>
                                            </p>
                                            <p>
                                                Evento:{" "}
                                                <span className="font-medium text-gray-900">
                                                    {detail.eventName || "No consignado"}
                                                </span>
                                            </p>
                                            <p>
                                                Pedido:{" "}
                                                <span className="font-medium text-gray-900">
                                                    {detail.orderId || "No consignado"}
                                                </span>
                                            </p>
                                            <p>
                                                Monto reclamado:{" "}
                                                <span className="font-medium text-gray-900">
                                                    {detail.amountClaimed ? formatPrice(detail.amountClaimed) : "No consignado"}
                                                </span>
                                            </p>
                                            <p>
                                                Cuenta web asociada:{" "}
                                                <span className="font-medium text-gray-900">
                                                    {detail.user?.email || "No aplica"}
                                                </span>
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div className="rounded-lg border p-4">
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Detalle del consumidor</p>
                                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                                            {detail.detail}
                                        </p>
                                    </div>
                                    <div className="rounded-lg border p-4">
                                        <p className="text-xs uppercase tracking-wide text-gray-500">Pedido del consumidor</p>
                                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                                            {detail.requestDetail}
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
                                    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-gray-700">Estado</label>
                                            <select
                                                value={nextStatus}
                                                onChange={(event) => setNextStatus(event.target.value as ComplaintStatus)}
                                                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm"
                                            >
                                                {STATUS_OPTIONS.filter((option) => option.value !== "ALL").map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-sm font-medium text-gray-700">
                                                Respuesta interna / al consumidor
                                            </label>
                                            <textarea
                                                value={responseDetail}
                                                onChange={(event) => setResponseDetail(event.target.value)}
                                                rows={7}
                                                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                                                placeholder="Registra la respuesta que desean comunicar al consumidor. Es obligatoria para marcar como respondido o cerrado."
                                            />
                                            <div className="flex justify-end">
                                                <Button
                                                    onClick={handleSave}
                                                    disabled={saving}
                                                    className="gap-2"
                                                >
                                                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                                    Guardar gestion
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
