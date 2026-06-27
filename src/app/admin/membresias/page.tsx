"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
    AlertCircle,
    CalendarClock,
    CheckCircle2,
    Clock,
    MapPin,
    RefreshCw,
    Save,
    Search,
    Ticket,
    Users,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { PaginationControls } from "@/components/ui/pagination-controls"
import { cn } from "@/lib/utils"

type StatusFilter = "ACTIVE" | "CANCELLED" | "EXPIRED" | "ALL"
type TicketStatus = "ACTIVE" | "CANCELLED" | "EXPIRED"
type StartSource = "ticket" | "event" | null

interface MembershipRow {
    id: string
    orderId: string
    userId: string
    eventId: string
    ticketTypeId: string
    ticketCode: string
    status: TicketStatus
    attendeeName: string | null
    attendeeDni: string | null
    membershipStartDate: string | null
    resolvedMembershipStartDate: string | null
    startSource: StartSource
    membershipExpiry: string | null
    monthlyClassLimit: number
    durationMonths: number
    scanCount: number
    paidAt: string | null
    event: {
        id: string
        title: string
        venue: string
        location: string
        servilexSucursalCode: string
        startDate: string | null
        endDate: string | null
        membershipStartFixed: string | null
        membershipStartMin: string | null
        membershipStartMax: string | null
    }
    ticketType: {
        id: string
        name: string
        monthlyClassLimit: number
        membershipDurationMonths: number
        membershipScheduleKey: string | null
        allowMultipleDailyScans: boolean
    }
    order: {
        id: string
        status: string
        buyerName: string | null
        buyerDocNumber: string | null
        buyerPhone: string | null
    }
    user: {
        id: string
        name: string | null
        email: string
    }
    freeze: {
        id: string
        month: string
        startDate: string | null
        endDate: string | null
    } | null
}

interface MembershipsData {
    memberships: MembershipRow[]
    stats: {
        totalMemberships: number
        activeMemberships: number
        missingTicketStart: number
        filteredTotal: number
    }
    pagination: {
        page: number
        pageSize: number
        total: number
        totalPages: number
    }
}

interface ApiResponse<T> {
    success: boolean
    data?: T
    error?: string
}

type RowMessage = {
    type: "success" | "error"
    text: string
}

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
    { value: "ACTIVE", label: "Activas" },
    { value: "CANCELLED", label: "Canceladas" },
    { value: "EXPIRED", label: "Expiradas" },
    { value: "ALL", label: "Todas" },
]

function formatDateLabel(value: string | null) {
    if (!value) return "-"
    return new Intl.DateTimeFormat("es-PE", {
        timeZone: "UTC",
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(new Date(`${value}T12:00:00Z`))
}

function durationLabel(months: number) {
    return `${months} ${months === 1 ? "mes" : "meses"}`
}

function statusLabel(status: TicketStatus) {
    if (status === "ACTIVE") return "Activa"
    if (status === "CANCELLED") return "Cancelada"
    return "Expirada"
}

function statusBadgeVariant(status: TicketStatus) {
    if (status === "ACTIVE") return "active"
    if (status === "CANCELLED") return "cancelled"
    return "expired"
}

function startSourceLabel(source: StartSource) {
    if (source === "ticket") return "Personalizada"
    if (source === "event") return "Del evento"
    return "Sin definir"
}

function compactCode(code: string) {
    return code.length > 14 ? `${code.slice(0, 6)}...${code.slice(-4)}` : code
}

export default function AdminMembershipsPage() {
    const [data, setData] = useState<MembershipsData | null>(null)
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [status, setStatus] = useState<StatusFilter>("ACTIVE")
    const [page, setPage] = useState(1)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [draftDates, setDraftDates] = useState<Record<string, string>>({})
    const [savingId, setSavingId] = useState<string | null>(null)
    const [rowMessages, setRowMessages] = useState<Record<string, RowMessage>>({})

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setDebouncedSearch(search.trim())
            setPage(1)
        }, 350)

        return () => window.clearTimeout(timer)
    }, [search])

    const loadMemberships = useCallback(async () => {
        setLoading(true)
        setError(null)

        try {
            const params = new URLSearchParams({
                page: String(page),
                pageSize: "25",
                status,
            })
            if (debouncedSearch) params.set("search", debouncedSearch)

            const response = await fetch(`/api/admin/memberships?${params.toString()}`, {
                cache: "no-store",
            })
            const payload = (await response.json()) as ApiResponse<MembershipsData>

            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error || "No se pudieron cargar las membresias")
            }

            const membershipsData = payload.data
            setData(membershipsData)
            setDraftDates((current) => {
                const next: Record<string, string> = {}
                for (const membership of membershipsData.memberships) {
                    next[membership.id] =
                        current[membership.id] ??
                        membership.membershipStartDate ??
                        membership.resolvedMembershipStartDate ??
                        ""
                }
                return next
            })
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Error inesperado")
        } finally {
            setLoading(false)
        }
    }, [debouncedSearch, page, status])

    useEffect(() => {
        loadMemberships()
    }, [loadMemberships])

    const stats = useMemo(
        () =>
            data?.stats ?? {
                totalMemberships: 0,
                activeMemberships: 0,
                missingTicketStart: 0,
                filteredTotal: 0,
            },
        [data]
    )

    const handleStatusChange = (nextStatus: StatusFilter) => {
        setStatus(nextStatus)
        setPage(1)
    }

    const handleSave = async (membership: MembershipRow) => {
        const membershipStartDate = draftDates[membership.id]?.trim() || ""
        if (!membershipStartDate) {
            setRowMessages((current) => ({
                ...current,
                [membership.id]: { type: "error", text: "Selecciona una fecha de inicio." },
            }))
            return
        }

        setSavingId(membership.id)
        setRowMessages((current) => {
            const next = { ...current }
            delete next[membership.id]
            return next
        })

        try {
            const response = await fetch("/api/admin/memberships", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticketId: membership.id, membershipStartDate }),
            })
            const payload = (await response.json()) as ApiResponse<{ membership: MembershipRow }>

            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error || "No se pudo guardar la fecha")
            }

            const updated = payload.data.membership
            setData((current) =>
                current
                    ? {
                          ...current,
                          memberships: current.memberships.map((item) =>
                              item.id === updated.id ? updated : item
                          ),
                      }
                    : current
            )
            setDraftDates((current) => ({
                ...current,
                [updated.id]: updated.membershipStartDate ?? updated.resolvedMembershipStartDate ?? "",
            }))
            setRowMessages((current) => ({
                ...current,
                [updated.id]: { type: "success", text: "Fecha actualizada." },
            }))
        } catch (saveError) {
            setRowMessages((current) => ({
                ...current,
                [membership.id]: {
                    type: "error",
                    text: saveError instanceof Error ? saveError.message : "Error al guardar",
                },
            }))
        } finally {
            setSavingId(null)
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                        Membresias
                    </h1>
                    <p className="text-sm text-gray-500">
                        Usuarios con tickets de membresia pagados en cualquier sede.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    onClick={loadMemberships}
                    disabled={loading}
                    className="w-full md:w-auto"
                >
                    <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    Actualizar
                </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                            <Users className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium uppercase text-gray-500">
                                Membresias
                            </p>
                            <p className="text-2xl font-semibold text-gray-900">
                                {stats.totalMemberships}
                            </p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-50 text-green-700">
                            <CheckCircle2 className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium uppercase text-gray-500">Activas</p>
                            <p className="text-2xl font-semibold text-gray-900">
                                {stats.activeMemberships}
                            </p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                            <CalendarClock className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium uppercase text-gray-500">
                                Sin fecha propia
                            </p>
                            <p className="text-2xl font-semibold text-gray-900">
                                {stats.missingTicketStart}
                            </p>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="flex items-center gap-3 p-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                            <Search className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-xs font-medium uppercase text-gray-500">
                                Resultado
                            </p>
                            <p className="text-2xl font-semibold text-gray-900">
                                {stats.filteredTotal}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <CardTitle className="text-lg">Buscar membresias</CardTitle>
                        <p className="text-sm text-gray-500">
                            Alumno, DNI, comprador, email, sede, plan o codigo.
                        </p>
                    </div>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="relative w-full lg:w-96">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar usuario de membresia"
                                className="pl-9"
                                aria-label="Buscar membresia"
                            />
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {statusFilters.map((filter) => (
                                <Button
                                    key={filter.value}
                                    type="button"
                                    size="sm"
                                    variant={status === filter.value ? "default" : "outline"}
                                    onClick={() => handleStatusChange(filter.value)}
                                >
                                    {filter.label}
                                </Button>
                            ))}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {error && (
                        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            <AlertCircle className="h-4 w-4" />
                            {error}
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[1180px] text-left text-sm">
                            <thead>
                                <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                                    <th className="px-4 py-3 font-semibold">Usuario</th>
                                    <th className="px-4 py-3 font-semibold">Membresia</th>
                                    <th className="px-4 py-3 font-semibold">Sede</th>
                                    <th className="px-4 py-3 font-semibold">Vigencia actual</th>
                                    <th className="px-4 py-3 font-semibold">Inicio</th>
                                    <th className="px-4 py-3 font-semibold">Accion</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {loading && !data ? (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                                            Cargando membresias...
                                        </td>
                                    </tr>
                                ) : data?.memberships.length ? (
                                    data.memberships.map((membership) => {
                                        const draftDate = draftDates[membership.id] ?? ""
                                        const effectiveDate =
                                            membership.membershipStartDate ??
                                            membership.resolvedMembershipStartDate ??
                                            ""
                                        const changed = draftDate !== effectiveDate
                                        const canSave =
                                            membership.status === "ACTIVE" &&
                                            Boolean(draftDate) &&
                                            (changed || membership.startSource !== "ticket")
                                        const message = rowMessages[membership.id]

                                        return (
                                            <tr key={membership.id} className="align-top hover:bg-gray-50/70">
                                                <td className="px-4 py-4">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-medium text-gray-900">
                                                                {membership.attendeeName ||
                                                                    membership.user.name ||
                                                                    "Sin nombre"}
                                                            </p>
                                                            <Badge
                                                                variant={statusBadgeVariant(membership.status)}
                                                                className="shrink-0"
                                                            >
                                                                {statusLabel(membership.status)}
                                                            </Badge>
                                                        </div>
                                                        <p className="text-xs text-gray-500">
                                                            DNI: {membership.attendeeDni || "-"}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            Comprador:{" "}
                                                            {membership.order.buyerName ||
                                                                membership.user.name ||
                                                                "-"}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {membership.user.email}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Ticket className="h-4 w-4 text-gray-400" />
                                                            <p className="font-medium text-gray-900">
                                                                {membership.ticketType.name}
                                                            </p>
                                                        </div>
                                                        <p className="text-xs text-gray-500">
                                                            {membership.monthlyClassLimit} clases/mes -{" "}
                                                            {durationLabel(membership.durationMonths)}
                                                        </p>
                                                        <p className="font-mono text-xs text-gray-500">
                                                            {compactCode(membership.ticketCode)}
                                                        </p>
                                                        {membership.freeze && (
                                                            <Badge variant="warning">
                                                                Congelada {membership.freeze.month}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <MapPin className="h-4 w-4 text-gray-400" />
                                                            <p className="font-medium text-gray-900">
                                                                {membership.event.venue}
                                                            </p>
                                                        </div>
                                                        <p className="text-xs text-gray-500">
                                                            {membership.event.location}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            Sucursal {membership.event.servilexSucursalCode}
                                                        </p>
                                                        <p className="line-clamp-2 text-xs text-gray-500">
                                                            {membership.event.title}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Clock className="h-4 w-4 text-gray-400" />
                                                            <p className="font-medium text-gray-900">
                                                                {formatDateLabel(
                                                                    membership.resolvedMembershipStartDate
                                                                )}
                                                            </p>
                                                        </div>
                                                        <p className="text-xs text-gray-500">
                                                            al {formatDateLabel(membership.membershipExpiry)}
                                                        </p>
                                                        <Badge variant="outline">
                                                            {startSourceLabel(membership.startSource)}
                                                        </Badge>
                                                        {membership.event.membershipStartFixed && (
                                                            <p className="text-xs text-gray-500">
                                                                Evento:{" "}
                                                                {formatDateLabel(
                                                                    membership.event.membershipStartFixed
                                                                )}
                                                            </p>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <div className="w-44 space-y-1">
                                                        <Input
                                                            type="date"
                                                            value={draftDate}
                                                            onChange={(event) =>
                                                                setDraftDates((current) => ({
                                                                    ...current,
                                                                    [membership.id]: event.target.value,
                                                                }))
                                                            }
                                                            disabled={membership.status !== "ACTIVE"}
                                                            aria-label={`Fecha de inicio ${membership.ticketCode}`}
                                                        />
                                                        {message && (
                                                            <p
                                                                className={cn(
                                                                    "text-xs",
                                                                    message.type === "success"
                                                                        ? "text-green-700"
                                                                        : "text-red-700"
                                                                )}
                                                            >
                                                                {message.text}
                                                            </p>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4">
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        onClick={() => handleSave(membership)}
                                                        disabled={!canSave || savingId === membership.id}
                                                    >
                                                        <Save className="h-4 w-4" />
                                                        Guardar
                                                    </Button>
                                                </td>
                                            </tr>
                                        )
                                    })
                                ) : (
                                    <tr>
                                        <td colSpan={6} className="px-4 py-10 text-center text-gray-500">
                                            No se encontraron membresias.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {data && (
                        <PaginationControls
                            page={data.pagination.page}
                            totalPages={data.pagination.totalPages}
                            total={data.pagination.total}
                            onPageChange={setPage}
                            label="membresias"
                            disabled={loading}
                        />
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
