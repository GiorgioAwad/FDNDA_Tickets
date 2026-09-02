"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
    AlertCircle,
    ArrowRight,
    CheckCircle2,
    Loader2,
    Search,
    UserRound,
    UsersRound,
} from "lucide-react"

import { ScheduleActions, type Plan } from "@/app/admin/membresias/[ticketId]/ScheduleActions"
import type { MembershipDetail } from "@/app/admin/membresias/[ticketId]/types"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface MembershipResult {
    id: string
    ticketCode: string
    attendeeName: string | null
    attendeeDni: string | null
    monthlyClassLimit: number
    ticketType: { name: string }
    user: { name: string | null; email: string }
}

interface MembershipListResponse {
    success: boolean
    error?: string
    data?: { memberships: MembershipResult[] }
}

interface MembershipDetailResponse {
    success: boolean
    error?: string
    data?: MembershipDetail
}

export function MembershipScheduleChangePanel({
    eventId,
    eventTitle,
    onApplied,
}: {
    eventId: string
    eventTitle: string
    onApplied: () => void
}) {
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [memberships, setMemberships] = useState<MembershipResult[]>([])
    const [selectedId, setSelectedId] = useState("")
    const [detail, setDetail] = useState<MembershipDetail | null>(null)
    const [appliedChange, setAppliedChange] = useState<Plan | null>(null)
    const [listLoading, setListLoading] = useState(true)
    const [detailLoading, setDetailLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const listRequestRef = useRef(0)
    const detailRequestRef = useRef(0)

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
        return () => window.clearTimeout(timer)
    }, [search])

    useEffect(() => {
        listRequestRef.current += 1
        detailRequestRef.current += 1
        setSearch("")
        setDebouncedSearch("")
        setSelectedId("")
        setDetail(null)
        setAppliedChange(null)
    }, [eventId])

    const loadMemberships = useCallback(async () => {
        const requestId = ++listRequestRef.current
        setListLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams({
                eventId,
                status: "ACTIVE",
                page: "1",
                pageSize: "12",
            })
            if (debouncedSearch) params.set("search", debouncedSearch)

            const response = await fetch(`/api/admin/memberships?${params.toString()}`, {
                cache: "no-store",
            })
            const payload = (await response.json()) as MembershipListResponse
            if (requestId !== listRequestRef.current) return
            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error ?? "No se pudieron cargar los asistentes")
            }
            setMemberships(payload.data.memberships)
        } catch (loadError) {
            if (requestId !== listRequestRef.current) return
            setMemberships([])
            setError(loadError instanceof Error ? loadError.message : "Error inesperado")
        } finally {
            if (requestId === listRequestRef.current) setListLoading(false)
        }
    }, [debouncedSearch, eventId])

    useEffect(() => {
        void loadMemberships()
    }, [loadMemberships])

    const loadDetail = useCallback(async (ticketId: string) => {
        const requestId = ++detailRequestRef.current
        setSelectedId(ticketId)
        setDetailLoading(true)
        setDetail(null)
        setAppliedChange(null)
        setError(null)
        try {
            const response = await fetch(`/api/admin/memberships/${ticketId}`, {
                cache: "no-store",
            })
            const payload = (await response.json()) as MembershipDetailResponse
            if (requestId !== detailRequestRef.current) return
            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error ?? "No se pudo cargar el carnet")
            }
            setDetail(payload.data)
        } catch (loadError) {
            if (requestId !== detailRequestRef.current) return
            setError(loadError instanceof Error ? loadError.message : "Error inesperado")
        } finally {
            if (requestId === detailRequestRef.current) setDetailLoading(false)
        }
    }, [])

    const handleApplied = async (plan: Plan) => {
        setAppliedChange(plan)
        onApplied()
        await Promise.all([loadMemberships(), loadDetail(selectedId)])
        setAppliedChange(plan)
    }

    return (
        <section aria-labelledby="schedule-change-title" className="space-y-4">
            <div className="max-w-3xl">
                <h2 id="schedule-change-title" className="text-2xl font-semibold tracking-tight text-slate-950">
                    Cambiar el horario de un asistente
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                    Busca a la persona, revisa su frecuencia comprada y elige únicamente entre los
                    horarios equivalentes disponibles de {eventTitle}.
                </p>
            </div>

            {error ? (
                <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                </div>
            ) : null}

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(19rem,0.78fr)_minmax(0,1.35fr)]">
                <div className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-card">
                    <div className="p-5">
                        <div className="flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 text-sky-200">
                                <UsersRound className="h-5 w-5" />
                            </span>
                            <div>
                                <h3 className="font-semibold">Selecciona al asistente</h3>
                                <p className="text-xs text-slate-300">Nombre, DNI, correo o código</p>
                            </div>
                        </div>
                        <label className="relative mt-4 block">
                            <span className="sr-only">Buscar asistente</span>
                            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                            <Input
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Buscar asistente"
                                className="border-white/15 bg-white text-slate-950 placeholder:text-slate-500 pl-9"
                            />
                        </label>
                    </div>

                    <div className="max-h-[34rem] overflow-y-auto border-t border-white/10">
                        {listLoading ? (
                            <div className="flex items-center justify-center gap-2 p-8 text-sm text-slate-300">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Buscando asistentes…
                            </div>
                        ) : memberships.length > 0 ? (
                            <ul className="divide-y divide-white/10">
                                {memberships.map((membership) => {
                                    const selected = membership.id === selectedId
                                    return (
                                        <li key={membership.id}>
                                            <button
                                                type="button"
                                                onClick={() => void loadDetail(membership.id)}
                                                className={cn(
                                                    "group flex w-full items-center gap-3 px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300",
                                                    selected ? "bg-sky-500/20" : "hover:bg-white/[0.07]"
                                                )}
                                                aria-pressed={selected}
                                            >
                                                <span className={cn(
                                                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                                                    selected ? "bg-sky-300 text-sky-950" : "bg-white/10 text-white/80"
                                                )}>
                                                    <UserRound className="h-4 w-4" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-semibold">
                                                        {membership.attendeeName || membership.user.name || "Sin nombre"}
                                                    </span>
                                                    <span className="mt-0.5 block truncate text-xs text-slate-300">
                                                        DNI {membership.attendeeDni || "—"} · {membership.ticketType.name}
                                                    </span>
                                                    <span className="mt-1 block truncate text-xs text-sky-100">
                                                        {membership.ticketCode} · {membership.user.email}
                                                    </span>
                                                </span>
                                                <ArrowRight className={cn(
                                                    "h-4 w-4 shrink-0 transition-transform",
                                                    selected ? "translate-x-0 text-sky-200" : "-translate-x-1 text-slate-500 group-hover:translate-x-0"
                                                )} />
                                            </button>
                                        </li>
                                    )
                                })}
                            </ul>
                        ) : (
                            <p className="p-8 text-center text-sm leading-6 text-slate-300">
                                No hay asistentes activos que coincidan con la búsqueda.
                            </p>
                        )}
                    </div>
                </div>

                <div className="min-w-0">
                    {detailLoading ? (
                        <div className="flex min-h-64 items-center justify-center gap-2 rounded-2xl bg-white text-sm text-slate-500 shadow-card">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Preparando horarios disponibles…
                        </div>
                    ) : detail ? (
                        <div className="space-y-4">
                            <div className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <h3 className="truncate text-lg font-semibold text-slate-950">
                                            {detail.ticket.attendeeName || detail.ticket.user.name || "Sin nombre"}
                                        </h3>
                                        <Badge variant="success">Activo</Badge>
                                    </div>
                                    <p className="mt-1 text-sm text-slate-600">
                                        {detail.ticket.attendeeDni || "Sin DNI"} · {detail.ticketType.name}
                                    </p>
                                </div>
                                <div className="shrink-0 text-left sm:text-right">
                                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Frecuencia comprada</p>
                                    <p className="mt-1 font-semibold tabular-nums text-slate-950">
                                        {detail.ticketType.monthlyClassLimit ?? "—"} clases por mes
                                    </p>
                                </div>
                            </div>

                            <ScheduleActions
                                detail={detail}
                                appliedChange={appliedChange}
                                onApplied={(plan) => void handleApplied(plan)}
                                sameEventOnly
                            />
                        </div>
                    ) : (
                        <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl bg-white px-6 text-center shadow-card">
                            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-700">
                                <CheckCircle2 className="h-6 w-6" />
                            </span>
                            <h3 className="mt-4 font-semibold text-slate-950">Elige una persona para comenzar</h3>
                            <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                                Verás su horario actual, las alternativas compatibles y el cupo actualizado antes de confirmar.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </section>
    )
}
