"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Database,
    Clock3,
    ExternalLink,
    HardDrive,
    Mail,
    MemoryStick,
    RefreshCw,
    Server,
} from "lucide-react"
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface HealthData {
    status: "healthy" | "degraded" | "unhealthy"
    timestamp: string
    version: string
    services: {
        database: { status: "up" | "down"; latency?: number }
        redis: { status: "up" | "down" | "disabled"; latency?: number }
        emailQueue: { status: "ok" | "warning" | "error"; pending?: number; failed?: number }
        invoiceQueue: { status: "ok" | "warning" | "error"; pending?: number; processing?: number; failed?: number; issued?: number }
        memory: { used: number; total: number; percentage: number }
    }
}

interface MonitoringData {
    captureConfigured: boolean
    apiConfigured: boolean
    missing: string[]
    organization: string | null
    project: string | null
    dashboardUrl: string
    issues: Array<{
        id: string
        shortId: string
        title: string
        culprit: string
        count: number
        users: number
        level: string
        lastSeen: string | null
        firstSeen: string | null
        url: string | null
    }>
    eventSeries: Array<{ timestamp: string; count: number }>
    events24h: number
    warnings: string[]
    refreshedAt: string
}

type LoadState = {
    health: HealthData | null
    sentry: MonitoringData | null
    error: string | null
}

const STATUS_COPY = {
    healthy: { label: "Operativo", className: "bg-emerald-100 text-emerald-800" },
    degraded: { label: "Con alertas", className: "bg-amber-100 text-amber-800" },
    unhealthy: { label: "Interrumpido", className: "bg-red-100 text-red-800" },
}

function formatRelativeDate(value: string | null): string {
    if (!value) return "Sin fecha"
    const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000)
    const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" })
    if (Math.abs(seconds) < 3600) return formatter.format(Math.round(seconds / 60), "minute")
    if (Math.abs(seconds) < 86400) return formatter.format(Math.round(seconds / 3600), "hour")
    return formatter.format(Math.round(seconds / 86400), "day")
}

function serviceTone(status: string) {
    if (["up", "ok", "disabled"].includes(status)) return "text-emerald-700 bg-emerald-50"
    if (status === "warning") return "text-amber-700 bg-amber-50"
    return "text-red-700 bg-red-50"
}

export default function MonitoringPage() {
    const [state, setState] = useState<LoadState>({ health: null, sentry: null, error: null })
    const [loading, setLoading] = useState(true)

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [healthResponse, sentryResponse] = await Promise.all([
                fetch("/api/health", { cache: "no-store" }),
                fetch("/api/admin/monitoring", { cache: "no-store" }),
            ])
            const health = (await healthResponse.json()) as HealthData
            const sentryPayload = await sentryResponse.json()
            if (!sentryResponse.ok || !sentryPayload.success) {
                throw new Error(sentryPayload.error ?? "No se pudo cargar el monitoreo")
            }
            setState({ health, sentry: sentryPayload.data as MonitoringData, error: null })
        } catch (error) {
            setState((current) => ({
                ...current,
                error: error instanceof Error ? error.message : "Error inesperado al actualizar",
            }))
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
        const timer = window.setInterval(() => void load(), 60_000)
        return () => window.clearInterval(timer)
    }, [load])

    const chartData = useMemo(
        () => (state.sentry?.eventSeries ?? []).map((point) => ({
            hour: new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", timeZone: "America/Lima" }).format(new Date(point.timestamp)),
            eventos: point.count,
        })),
        [state.sentry?.eventSeries]
    )

    const healthStatus = state.health?.status ?? "degraded"
    const statusCopy = STATUS_COPY[healthStatus]

    return <MonitoringContent state={state} loading={loading} load={load} chartData={chartData} statusCopy={statusCopy} />
}

function MonitoringContent({
    state,
    loading,
    load,
    chartData,
    statusCopy,
}: {
    state: LoadState
    loading: boolean
    load: () => Promise<void>
    chartData: Array<{ hour: string; eventos: number }>
    statusCopy: { label: string; className: string }
}) {
    const health = state.health
    const sentry = state.sentry

    return (
        <div className="space-y-6 p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Estado de la plataforma</h2>
                    <p className="mt-1 max-w-2xl text-sm text-slate-600">
                        Salud de servicios internos e incidencias reportadas por Sentry. Se actualiza cada minuto.
                    </p>
                </div>
                <Button type="button" variant="outline" onClick={() => void load()} disabled={loading} className="gap-2">
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    Actualizar ahora
                </Button>
            </div>

            {state.error ? (
                <div className="flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800" role="alert">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div><p className="font-semibold">No se pudo actualizar el panel</p><p>{state.error}</p></div>
                </div>
            ) : null}

            <section className="overflow-hidden rounded-2xl bg-slate-950 text-white">
                <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                        <span className={`flex h-12 w-12 items-center justify-center rounded-full ${healthStatusIconClass(health?.status)}`}>
                            {health?.status === "healthy" ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
                        </span>
                        <div>
                            <p className="text-sm text-slate-300">Estado general</p>
                            <p className="text-2xl font-semibold">{statusCopy.label}</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
                        <span>Version {health?.version ?? "-"}</span>
                        <span>Actualizado {formatRelativeDate(sentry?.refreshedAt ?? health?.timestamp ?? null)}</span>
                    </div>
                </div>
            </section>

            {health ? (
                <section>
                    <h3 className="mb-3 text-lg font-semibold text-slate-950">Servicios internos</h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <ServiceTile
                            icon={Database}
                            label="Base de datos"
                            status={health.services.database.status}
                            detail={health.services.database.latency != null ? `${health.services.database.latency} ms` : "Sin respuesta"}
                        />
                        <ServiceTile
                            icon={HardDrive}
                            label="Redis y cache"
                            status={health.services.redis.status}
                            detail={health.services.redis.status === "disabled" ? "No configurado" : health.services.redis.latency != null ? `${health.services.redis.latency} ms` : "Sin respuesta"}
                        />
                        <ServiceTile
                            icon={Mail}
                            label="Cola de correos"
                            status={health.services.emailQueue.status}
                            detail={`${health.services.emailQueue.pending ?? 0} pendientes - ${health.services.emailQueue.failed ?? 0} fallidos`}
                        />
                        <ServiceTile
                            icon={Server}
                            label="Comprobantes ABIO"
                            status={health.services.invoiceQueue.status}
                            detail={`${health.services.invoiceQueue.pending ?? 0} pendientes - ${health.services.invoiceQueue.failed ?? 0} fallidos`}
                        />
                    </div>
                    <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
                        <MemoryStick className="h-5 w-5 text-slate-500" />
                        <span className="font-medium text-slate-800">Memoria del proceso</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-label={`${health.services.memory.percentage}% de memoria usada`}>
                            <div
                                className={`h-full rounded-full ${health.services.memory.percentage > 90 ? "bg-red-500" : health.services.memory.percentage > 75 ? "bg-amber-500" : "bg-emerald-500"}`}
                                style={{ width: `${Math.min(health.services.memory.percentage, 100)}%` }}
                            />
                        </div>
                        <span className="tabular-nums text-slate-600">{health.services.memory.used} / {health.services.memory.total} MB</span>
                    </div>
                </section>
            ) : null}

            {sentry && !sentry.apiConfigured ? (
                <div className="rounded-2xl bg-amber-50 p-5 text-amber-950">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                        <div className="space-y-2">
                            <p className="font-semibold">Completa la conexion de lectura con Sentry</p>
                            <p className="max-w-3xl text-sm text-amber-900">
                                La captura {sentry.captureConfigured ? "esta activa" : "todavia no tiene DSN"}, pero faltan {sentry.missing.join(", ")} para consultar incidencias desde este panel.
                            </p>
                            <Link href={sentry.dashboardUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold underline underline-offset-4">
                                Abrir Sentry <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                        </div>
                    </div>
                </div>
            ) : null}

            {sentry?.warnings.length ? (
                <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {sentry.warnings.join(" - ")}. El resto del panel sigue disponible.
                </div>
            ) : null}

            {sentry?.apiConfigured ? (
                <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(24rem,.95fr)]">
                    <Card>
                        <CardHeader className="flex-row items-start justify-between space-y-0">
                            <div>
                                <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Eventos recibidos</CardTitle>
                                <p className="mt-1 text-sm text-slate-500">Ultimas 24 horas en el proyecto {sentry.project}</p>
                            </div>
                            <span className="text-2xl font-semibold tabular-nums text-slate-950">{sentry.events24h}</span>
                        </CardHeader>
                        <CardContent>
                            {chartData.length > 0 ? (
                                <div className="h-72" aria-label="Eventos de Sentry recibidos por hora">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                            <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                                            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                                            <Tooltip cursor={{ fill: "#f1f5f9" }} />
                                            <Bar dataKey="eventos" fill="#0f766e" radius={[5, 5, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div className="flex h-72 items-center justify-center text-sm text-slate-500">Sin eventos recibidos en las ultimas 24 horas.</div>
                            )}
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="flex-row items-start justify-between space-y-0">
                            <div>
                                <CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5" />Incidencias sin resolver</CardTitle>
                                <p className="mt-1 text-sm text-slate-500">Ordenadas por actividad reciente</p>
                            </div>
                            <Button variant="ghost" size="sm" asChild>
                                <Link href={sentry.dashboardUrl} target="_blank" rel="noreferrer" className="gap-1">
                                    Ver todas <ExternalLink className="h-3.5 w-3.5" />
                                </Link>
                            </Button>
                        </CardHeader>
                        <CardContent className="p-0">
                            {sentry.issues.length > 0 ? (
                                <div className="divide-y divide-slate-100">
                                    {sentry.issues.map((issue) => (
                                        <Link
                                            key={issue.id || `${issue.shortId}-${issue.title}`}
                                            href={issue.url || sentry.dashboardUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="group block px-6 py-4 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fdnda-primary"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <p className="truncate font-medium text-slate-900 group-hover:text-fdnda-primary">{issue.title}</p>
                                                    <p className="mt-1 truncate text-xs text-slate-500">{issue.shortId}{issue.culprit ? ` - ${issue.culprit}` : ""}</p>
                                                </div>
                                                <span className="whitespace-nowrap text-xs text-slate-500">{formatRelativeDate(issue.lastSeen)}</span>
                                            </div>
                                            <div className="mt-2 flex items-center gap-4 text-xs text-slate-600">
                                                <span className="tabular-nums">{issue.count} eventos</span>
                                                <span className="tabular-nums">{issue.users} usuarios</span>
                                                <span className="capitalize">{issue.level}</span>
                                            </div>
                                        </Link>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
                                    <CheckCircle2 className="h-9 w-9 text-emerald-600" />
                                    <p className="mt-3 font-medium text-slate-900">Sin incidencias abiertas</p>
                                    <p className="mt-1 text-sm text-slate-500">No hay problemas sin resolver en el periodo consultado.</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </section>
            ) : null}

            <p className="flex items-center gap-2 text-xs text-slate-500">
                <Clock3 className="h-3.5 w-3.5" />
                Este panel es de observacion. La gestion y resolucion de incidencias se realiza en Sentry.
            </p>
        </div>
    )
}

function healthStatusIconClass(status: HealthData["status"] | undefined): string {
    if (status === "healthy") return "bg-emerald-400/15 text-emerald-300"
    if (status === "unhealthy") return "bg-red-400/15 text-red-300"
    return "bg-amber-400/15 text-amber-300"
}

function ServiceTile({
    icon: Icon,
    label,
    status,
    detail,
}: {
    icon: React.ElementType
    label: string
    status: string
    detail: string
}) {
    return (
        <div className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${serviceTone(status)}`}>
                <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
                <p className="font-medium text-slate-900">{label}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">{detail}</p>
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{status}</p>
            </div>
        </div>
    )
}
