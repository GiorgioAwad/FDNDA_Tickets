"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import * as XLSX from "xlsx"
import {
    AlertCircle,
    CheckCircle2,
    Download,
    FileSpreadsheet,
    Loader2,
    RefreshCw,
    Users,
    Waves,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
    POOL_REPORT_WEEKDAYS,
    type ConsolidatedPoolBuyer,
    type PoolBuyerVisit,
    type PoolInventoryReportRow,
} from "@/lib/pool-buyer-report"

interface ReportFilters {
    from: string
    to: string
    startTime: string
    endTime: string
    weekdays: number[]
}

interface PoolReportData {
    filters: ReportFilters
    summary: {
        buyers: number
        visits: number
        directVisits: number
        bagVisits: number
        inventoryRows: number
    }
    buyers: ConsolidatedPoolBuyer[]
    visits: PoolBuyerVisit[]
    inventory: PoolInventoryReportRow[]
}

function dateKey(date: Date): string {
    return date.toISOString().slice(0, 10)
}

function getCurrentWeekFilters(): ReportFilters {
    const limaDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date())
    const today = new Date(`${limaDate}T12:00:00.000Z`)
    const isoDay = today.getUTCDay() || 7
    const monday = new Date(today)
    monday.setUTCDate(today.getUTCDate() - isoDay + 1)
    const sunday = new Date(monday)
    sunday.setUTCDate(monday.getUTCDate() + 6)

    return {
        from: dateKey(monday),
        to: dateKey(sunday),
        startTime: "18:00",
        endTime: "19:00",
        weekdays: [4, 5],
    }
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat("es-PE", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00.000Z`))
}

export default function PoolBuyersReportPage() {
    const initialFilters = useMemo(() => getCurrentWeekFilters(), [])
    const [filters, setFilters] = useState<ReportFilters>(initialFilters)
    const [data, setData] = useState<PoolReportData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const loadReport = useCallback(async (nextFilters: ReportFilters) => {
        setLoading(true)
        setError(null)
        try {
            const params = new URLSearchParams({
                from: nextFilters.from,
                to: nextFilters.to,
                startTime: nextFilters.startTime,
                endTime: nextFilters.endTime,
                weekdays: nextFilters.weekdays.join(","),
            })
            const response = await fetch(`/api/admin/reports/pool-buyers?${params.toString()}`)
            const result = await response.json()
            if (!response.ok || !result.success) {
                throw new Error(result.error || "No se pudo consultar el reporte.")
            }
            setData(result.data)
        } catch (cause) {
            setData(null)
            setError(cause instanceof Error ? cause.message : "No se pudo consultar el reporte.")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void loadReport(initialFilters)
    }, [initialFilters, loadReport])

    const toggleWeekday = (weekday: number) => {
        setFilters((current) => {
            const selected = current.weekdays.includes(weekday)
            if (selected && current.weekdays.length === 1) return current
            return {
                ...current,
                weekdays: selected
                    ? current.weekdays.filter((value) => value !== weekday)
                    : [...current.weekdays, weekday].sort((a, b) => a - b),
            }
        })
    }

    const exportToExcel = () => {
        if (!data) return

        const workbook = XLSX.utils.book_new()
        const buyerRows = data.buyers.map((buyer) => ({
            Comprador: buyer.buyerName,
            Documento: buyer.buyerDocument,
            Correo: buyer.buyerEmail,
            Teléfono: buyer.buyerPhone,
            Asistentes: buyer.attendees.join(" | "),
            "Cupos comprados/reservados": buyer.visitCount,
            "Fechas, horarios y sede": buyer.visits.join(" | "),
            Origen: buyer.sources.join(" | "),
            "Órdenes ID": buyer.orderIds.join(" | "),
        }))
        const detailRows = data.visits.map((visit) => ({
            Evento: visit.eventName,
            Fecha: visit.date,
            Horario: visit.schedule,
            Comprador: visit.buyerName,
            Documento: visit.buyerDocument,
            Correo: visit.buyerEmail,
            Teléfono: visit.buyerPhone,
            Asistente: visit.attendeeName,
            "DNI asistente": visit.attendeeDocument,
            Origen: visit.source,
            "Fecha de pago": new Date(visit.paidAt).toLocaleString("es-PE", {
                timeZone: "America/Lima",
            }),
            "Orden ID": visit.orderId,
            "Código/reserva": visit.reservationId,
        }))
        const inventoryRows = data.inventory.map((row) => ({
            Evento: row.eventName,
            Fecha: row.date,
            Horario: row.schedule,
            Cupo: row.capacity,
            "Vendidos (inventario)": row.sold,
            "Filas encontradas": row.found,
            Coincide: row.matches ? "SÍ" : "NO",
            Estado: row.enabled ? "Abierto" : "Cerrado",
        }))

        const buyersSheet = XLSX.utils.json_to_sheet(buyerRows)
        buyersSheet["!cols"] = [32, 15, 32, 16, 42, 24, 90, 30, 60].map((wch) => ({ wch }))
        XLSX.utils.book_append_sheet(workbook, buyersSheet, "Compradores")

        const detailSheet = XLSX.utils.json_to_sheet(detailRows)
        detailSheet["!cols"] = [36, 12, 18, 32, 15, 32, 16, 30, 15, 30, 22, 28, 30].map((wch) => ({ wch }))
        XLSX.utils.book_append_sheet(workbook, detailSheet, "Detalle por cupo")

        const inventorySheet = XLSX.utils.json_to_sheet(inventoryRows)
        inventorySheet["!cols"] = [36, 12, 18, 10, 20, 18, 10, 12].map((wch) => ({ wch }))
        XLSX.utils.book_append_sheet(workbook, inventorySheet, "Validación")

        const safeTime = `${data.filters.startTime}-${data.filters.endTime}`.replaceAll(":", "")
        XLSX.writeFile(
            workbook,
            `compradores_piscina_${data.filters.from}_${data.filters.to}_${safeTime}.xlsx`
        )
    }

    const hasMismatches = data?.inventory.some((row) => !row.matches) ?? false

    return (
        <div className="space-y-6 pb-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-2xl">
                    <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                        Compradores de piscina libre
                    </h1>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Consulta entradas directas y reservas de bolsa por fecha, día y horario. La descarga incluye compradores, detalle por cupo y conciliación con el inventario.
                    </p>
                </div>
                <Button
                    variant="outline"
                    className="w-full gap-2 sm:w-auto"
                    onClick={exportToExcel}
                    disabled={!data || loading}
                >
                    <Download className="h-4 w-4" />
                    Descargar Excel
                </Button>
            </div>

            <Card>
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg">Filtros del reporte</CardTitle>
                </CardHeader>
                <CardContent>
                    <form
                        className="space-y-5"
                        onSubmit={(event) => {
                            event.preventDefault()
                            void loadReport(filters)
                        }}
                    >
                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <label className="space-y-1.5 text-sm font-medium text-foreground">
                                <span>Desde</span>
                                <Input
                                    type="date"
                                    value={filters.from}
                                    onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
                                    required
                                />
                            </label>
                            <label className="space-y-1.5 text-sm font-medium text-foreground">
                                <span>Hasta</span>
                                <Input
                                    type="date"
                                    value={filters.to}
                                    onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
                                    required
                                />
                            </label>
                            <label className="space-y-1.5 text-sm font-medium text-foreground">
                                <span>Hora de inicio</span>
                                <Input
                                    type="time"
                                    value={filters.startTime}
                                    onChange={(event) => setFilters((current) => ({ ...current, startTime: event.target.value }))}
                                    required
                                />
                            </label>
                            <label className="space-y-1.5 text-sm font-medium text-foreground">
                                <span>Hora de fin</span>
                                <Input
                                    type="time"
                                    value={filters.endTime}
                                    onChange={(event) => setFilters((current) => ({ ...current, endTime: event.target.value }))}
                                    required
                                />
                            </label>
                        </div>

                        <fieldset>
                            <legend className="mb-2 text-sm font-medium text-foreground">Días incluidos</legend>
                            <div className="flex flex-wrap gap-2">
                                {POOL_REPORT_WEEKDAYS.map((day) => {
                                    const selected = filters.weekdays.includes(day.value)
                                    return (
                                        <button
                                            key={day.value}
                                            type="button"
                                            aria-pressed={selected}
                                            onClick={() => toggleWeekday(day.value)}
                                            className={`min-h-10 rounded-lg border px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                                selected
                                                    ? "border-fdnda-primary bg-fdnda-primary text-white"
                                                    : "border-border bg-background text-muted-foreground hover:border-fdnda-primary/40 hover:text-foreground"
                                            }`}
                                        >
                                            {day.label}
                                        </button>
                                    )
                                })}
                            </div>
                        </fieldset>

                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs leading-5 text-muted-foreground">
                                Predeterminado: semana actual, jueves y viernes de 18:00 a 19:00.
                            </p>
                            <div className="flex flex-col-reverse gap-2 sm:flex-row">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setFilters(getCurrentWeekFilters())}
                                    disabled={loading}
                                >
                                    <RefreshCw className="h-4 w-4" />
                                    Restablecer
                                </Button>
                                <Button type="submit" loading={loading}>
                                    Consultar compradores
                                </Button>
                            </div>
                        </div>
                    </form>
                </CardContent>
            </Card>

            {error && (
                <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-900">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                        <p className="font-semibold">No se pudo cargar el reporte</p>
                        <p className="mt-1 text-sm text-red-700">{error} Revisa los filtros e inténtalo nuevamente.</p>
                    </div>
                </div>
            )}

            {loading && !data ? (
                <div className="flex min-h-56 items-center justify-center" aria-live="polite">
                    <Loader2 className="h-7 w-7 animate-spin text-fdnda-primary" />
                    <span className="ml-3 text-sm text-muted-foreground">Consultando compras y reservas…</span>
                </div>
            ) : data ? (
                <>
                    <section className="overflow-hidden rounded-xl bg-fdnda-primary text-white shadow-lg shadow-blue-950/10">
                        <div className="grid sm:grid-cols-3">
                            <div className="p-5 sm:p-6">
                                <div className="flex items-center gap-2 text-blue-100">
                                    <Users className="h-4 w-4" />
                                    <span className="text-sm font-medium">Compradores únicos</span>
                                </div>
                                <p className="mt-2 text-3xl font-bold tabular-nums">{data.summary.buyers}</p>
                            </div>
                            <div className="border-t border-white/15 p-5 sm:border-l sm:border-t-0 sm:p-6">
                                <div className="flex items-center gap-2 text-blue-100">
                                    <Waves className="h-4 w-4" />
                                    <span className="text-sm font-medium">Cupos encontrados</span>
                                </div>
                                <p className="mt-2 text-3xl font-bold tabular-nums">{data.summary.visits}</p>
                            </div>
                            <div className="border-t border-white/15 p-5 sm:border-l sm:border-t-0 sm:p-6">
                                <div className="flex items-center gap-2 text-blue-100">
                                    <FileSpreadsheet className="h-4 w-4" />
                                    <span className="text-sm font-medium">Directas / bolsa</span>
                                </div>
                                <p className="mt-2 text-3xl font-bold tabular-nums">
                                    {data.summary.directVisits} / {data.summary.bagVisits}
                                </p>
                            </div>
                        </div>
                    </section>

                    <Card>
                        <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="text-lg">Detalle de compradores</CardTitle>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {data.filters.from === data.filters.to
                                        ? formatDate(data.filters.from)
                                        : `${formatDate(data.filters.from)} – ${formatDate(data.filters.to)}`}
                                    {` · ${data.filters.startTime}–${data.filters.endTime}`}
                                </p>
                            </div>
                            <Badge className={hasMismatches ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}>
                                {hasMismatches ? (
                                    <><AlertCircle className="mr-1 h-3.5 w-3.5" /> Revisar conciliación</>
                                ) : (
                                    <><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Inventario conciliado</>
                                )}
                            </Badge>
                        </CardHeader>
                        <CardContent>
                            {data.visits.length === 0 ? (
                                <div className="py-12 text-center">
                                    <Waves className="mx-auto h-10 w-10 text-sky-200" />
                                    <p className="mt-4 font-semibold text-foreground">No hay compradores en esta selección</p>
                                    <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                                        Prueba otro rango, activa días adicionales o modifica la franja horaria.
                                    </p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[920px] text-sm">
                                        <thead>
                                            <tr className="border-b text-left text-muted-foreground">
                                                <th className="pb-3 pr-4 font-medium">Fecha</th>
                                                <th className="pb-3 pr-4 font-medium">Comprador</th>
                                                <th className="pb-3 pr-4 font-medium">Asistente</th>
                                                <th className="pb-3 pr-4 font-medium">Contacto</th>
                                                <th className="pb-3 pr-4 font-medium">Sede</th>
                                                <th className="pb-3 font-medium">Origen</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.visits.map((visit) => (
                                                <tr key={`${visit.reservationId}-${visit.date}`} className="border-b last:border-0">
                                                    <td className="py-4 pr-4 align-top">
                                                        <p className="font-semibold text-foreground">{formatDate(visit.date)}</p>
                                                        <p className="mt-1 tabular-nums text-muted-foreground">{visit.schedule}</p>
                                                    </td>
                                                    <td className="py-4 pr-4 align-top">
                                                        <p className="font-medium text-foreground">{visit.buyerName || "Sin nombre"}</p>
                                                        <p className="mt-1 text-xs text-muted-foreground">{visit.buyerDocument || "Sin documento"}</p>
                                                    </td>
                                                    <td className="py-4 pr-4 align-top">
                                                        <p className="text-foreground">{visit.attendeeName || "—"}</p>
                                                        <p className="mt-1 text-xs text-muted-foreground">{visit.attendeeDocument || ""}</p>
                                                    </td>
                                                    <td className="py-4 pr-4 align-top">
                                                        <p className="text-foreground">{visit.buyerEmail || "—"}</p>
                                                        <p className="mt-1 text-xs text-muted-foreground">{visit.buyerPhone || ""}</p>
                                                    </td>
                                                    <td className="max-w-64 py-4 pr-4 align-top text-muted-foreground">{visit.eventName}</td>
                                                    <td className="py-4 align-top">
                                                        <Badge variant="outline">{visit.source}</Badge>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            {data.inventory.length > 0 && (
                                <div className="mt-6 border-t pt-5">
                                    <h2 className="text-sm font-semibold text-foreground">Conciliación por fecha</h2>
                                    <div className="mt-3 grid gap-2 lg:grid-cols-2">
                                        {data.inventory.map((row) => (
                                            <div
                                                key={`${row.eventId}-${row.date}-${row.schedule}`}
                                                className="flex items-center justify-between gap-4 rounded-lg bg-muted/55 px-4 py-3 text-sm"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-medium text-foreground">{formatDate(row.date)} · {row.schedule}</p>
                                                    <p className="truncate text-xs text-muted-foreground">{row.eventName}</p>
                                                </div>
                                                <div className="shrink-0 text-right tabular-nums">
                                                    <p className="font-semibold text-foreground">{row.found} de {row.sold}</p>
                                                    <p className={`text-xs ${row.matches ? "text-emerald-700" : "text-amber-700"}`}>
                                                        {row.matches ? "Coincide" : "Revisar"}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </>
            ) : null}
        </div>
    )
}
