"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AlertCircle, ArrowLeft, BarChart3, Download, Search, UsersRound } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const WEEKDAY_LABEL: Record<number, string> = {
    0: "Domingo",
    1: "Lunes",
    2: "Martes",
    3: "Miercoles",
    4: "Jueves",
    5: "Viernes",
    6: "Sabado",
}

interface EventOption {
    id: string
    title: string
    servilexSucursalCode: string
}

interface SlotRow {
    ticketTypeName: string
    categoryLabel: string
    frequencyLabel: string
    weekday: number
    label: string
    enrolled: number
}

interface DayLoadCell {
    weekday: number
    label: string
    total: number
}

interface PlanRow {
    ticketTypeId: string
    name: string
    capacity: number
    sold: number
    available: number | null
    currentMembers: number
    durationMonths: number | null
    monthlyClassLimit: number | null
    price: number | null
    isActive: boolean
}

interface ScheduleRow {
    ticketTypeId: string
    ticketTypeName: string
    durationMonths: number | null
    category: string
    categoryLabel: string
    frequency: string
    frequencyLabel: string
    groupLabel: string
    label: string
    enrolled: number
    capacityInPlan: number
    soldInPlan: number
    availableInPlan: number | null
    currentMembersInPlan: number
    monthlyClassLimit: number | null
    price: number | null
    isActive: boolean
    status: "SCHEDULED" | "FREE_ACCESS" | "MISSING_SCHEDULE"
}

interface OccupancyPayload {
    slots: SlotRow[]
    dayLoad: DayLoadCell[]
    planTotals: PlanRow[]
    scheduleRows: ScheduleRow[]
    currentMembers: number
    missingSchedule: number
}

interface OccupancyApiResponse {
    success: boolean
    error?: string
    data?: {
        events: EventOption[]
        event: EventOption | null
        occupancy: OccupancyPayload | null
    }
}

export default function MembershipOccupancyPage() {
    const searchParams = useSearchParams()
    const [events, setEvents] = useState<EventOption[]>([])
    const [eventId, setEventId] = useState(() => searchParams.get("eventId") ?? "")
    const [occupancy, setOccupancy] = useState<OccupancyPayload | null>(null)
    const [query, setQuery] = useState("")
    const [category, setCategory] = useState("all")
    const [frequency, setFrequency] = useState("all")
    const [exporting, setExporting] = useState(false)
    // Cubre tanto la carga inicial (lista de eventos) como cada recalculo al
    // cambiar de evento: esta pantalla no tiene nada util que mostrar hasta
    // que responde el endpoint, asi que no hace falta distinguirlas.
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // Id de peticion monotonico: si el admin cambia de evento con una
    // respuesta anterior todavia en vuelo y las respuestas llegan fuera de
    // orden, cualquier escritura de estado de una peticion que ya no es la
    // vigente se descarta. Sin esto se puede pintar la ocupacion del evento
    // anterior mientras el selector ya muestra el nuevo.
    const requestIdRef = useRef(0)

    const load = useCallback(async (id: string) => {
        const requestId = ++requestIdRef.current
        setLoading(true)
        setError(null)
        try {
            const query = id ? `?eventId=${id}` : ""
            const response = await fetch(`/api/admin/membership-occupancy${query}`, {
                cache: "no-store",
            })
            const payload = (await response.json()) as OccupancyApiResponse
            if (requestId !== requestIdRef.current) return // superada por una peticion mas nueva
            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error ?? "No se pudo cargar la ocupacion")
            }
            setEvents(payload.data.events)
            setOccupancy(payload.data.occupancy)
        } catch (loadError) {
            if (requestId !== requestIdRef.current) return // superada por una peticion mas nueva
            setError(loadError instanceof Error ? loadError.message : "Error inesperado")
            setOccupancy(null)
        } finally {
            if (requestId === requestIdRef.current) setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load(eventId)
    }, [eventId, load])

    const slots = occupancy?.slots ?? []
    const dayLoad = occupancy?.dayLoad ?? []
    const planTotals = occupancy?.planTotals ?? []
    const scheduleRows = useMemo(() => occupancy?.scheduleRows ?? [], [occupancy?.scheduleRows])
    const selectedEvent = events.find((event) => event.id === eventId) ?? null
    const categoryOptions = useMemo(
        () => [...new Set(scheduleRows.map((row) => row.categoryLabel))].sort((a, b) => a.localeCompare(b, "es")),
        [scheduleRows]
    )
    const frequencyOptions = useMemo(
        () => [...new Set(scheduleRows.map((row) => row.frequencyLabel))].sort((a, b) => a.localeCompare(b, "es")),
        [scheduleRows]
    )
    const filteredScheduleRows = useMemo(() => {
        const term = query.trim().toLocaleLowerCase("es")
        return scheduleRows.filter((row) => {
            if (category !== "all" && row.categoryLabel !== category) return false
            if (frequency !== "all" && row.frequencyLabel !== frequency) return false
            if (!term) return true
            return [row.ticketTypeName, row.categoryLabel, row.frequencyLabel, row.groupLabel, row.label]
                .join(" ")
                .toLocaleLowerCase("es")
                .includes(term)
        })
    }, [category, frequency, query, scheduleRows])

    const exportReport = async () => {
        if (!occupancy || !selectedEvent) return
        setExporting(true)
        try {
            const XLSX = await import("xlsx")
            const workbook = XLSX.utils.book_new()
            const scheduleSheet = XLSX.utils.json_to_sheet(
                scheduleRows.map((row) => ({
                    Evento: selectedEvent.title,
                    Plan: row.ticketTypeName,
                    Duracion: durationLabel(row.durationMonths),
                    Categoria: row.categoryLabel,
                    Frecuencia: row.frequencyLabel,
                    Dias: row.groupLabel,
                    Horario: row.label,
                    "Inscritos vigentes": row.enrolled,
                    "Cupo global del plan": row.capacityInPlan === 0 ? "Ilimitado" : row.capacityInPlan,
                    "Vendidos del plan": row.soldInPlan,
                    "Disponibles del plan": row.availableInPlan ?? "Ilimitado",
                    "Carnets vigentes del plan": row.currentMembersInPlan,
                    "Clases por mes": row.monthlyClassLimit ?? "",
                    "Precio S/": row.price ?? "",
                    Estado: row.isActive ? "Activo" : "Inactivo",
                }))
            )
            scheduleSheet["!cols"] = [
                { wch: 38 }, { wch: 42 }, { wch: 14 }, { wch: 22 }, { wch: 28 },
                { wch: 28 }, { wch: 24 }, { wch: 18 }, { wch: 22 }, { wch: 18 },
                { wch: 22 }, { wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
            ]
            XLSX.utils.book_append_sheet(workbook, scheduleSheet, "Cupos por horario")

            const loadSheet = XLSX.utils.json_to_sheet(
                dayLoad.map((cell) => ({
                    Dia: WEEKDAY_LABEL[cell.weekday] ?? cell.weekday,
                    Horario: cell.label,
                    Alumnos: cell.total,
                }))
            )
            XLSX.utils.book_append_sheet(workbook, loadSheet, "Carga por dia y hora")

            const planSheet = XLSX.utils.json_to_sheet(
                planTotals.map((plan) => ({
                    Plan: plan.name,
                    Duracion: durationLabel(plan.durationMonths),
                    "Carnets vigentes": plan.currentMembers,
                    Vendidos: plan.sold,
                    "Cupo global": plan.capacity === 0 ? "Ilimitado" : plan.capacity,
                    Disponible: plan.available ?? "Ilimitado",
                    "Clases por mes": plan.monthlyClassLimit ?? "",
                    "Precio S/": plan.price ?? "",
                    Estado: plan.isActive ? "Activo" : "Inactivo",
                }))
            )
            XLSX.utils.book_append_sheet(workbook, planSheet, "Cupo por plan")

            const noteSheet = XLSX.utils.aoa_to_sheet([
                ["Reporte", `Cupos, horarios y frecuencias - ${selectedEvent.title}`],
                ["Generado", new Date().toLocaleString("es-PE", { timeZone: "America/Lima" })],
                ["Fuente", "Carnets ACTIVE con orden PAID y horario efectivo del mes actual"],
                ["Carnets vigentes", occupancy.currentMembers],
                ["Sin horario por regularizar", occupancy.missingSchedule],
                [],
                ["Importante", "El disponible mostrado es global por plan. La plataforma no tiene un aforo independiente por franja horaria."],
            ])
            noteSheet["!cols"] = [{ wch: 34 }, { wch: 110 }]
            XLSX.utils.book_append_sheet(workbook, noteSheet, "Leyenda")

            const slug = selectedEvent.title.toLocaleLowerCase("es").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
            const date = limaDateKey(new Date())
            XLSX.writeFile(workbook, `cupos-horarios-frecuencias-${slug}-${date}.xlsx`)
        } finally {
            setExporting(false)
        }
    }
    const hasSelection = Boolean(eventId)
    const hasOccupancyRows = slots.length > 0 || dayLoad.length > 0
    // planTotals no depende de la vigencia de hoy (es capacity/sold del
    // TicketType), asi que sirve para saber si el evento tiene ventas de
    // verdad aunque las tablas por franja esten vacias.
    const hasSales = planTotals.some((plan) => plan.sold > 0)
    const showNoEventNotice = !hasSelection && !loading && !error
    const showEmptyEventNotice =
        hasSelection && !loading && !error && occupancy !== null && !hasOccupancyRows && !hasSales
    // Hay carnets vendidos (planTotals lo confirma) pero ninguno aporto una
    // franja: puede ser porque los planes de esta sede no usan horario
    // semanal (el tipo de entrada ES la franja, como en VMT) o porque el
    // carnet vigente no tiene un horario resuelto para hoy. No se puede
    // distinguir con certeza sin tocar el endpoint (cerrado), asi que el
    // texto cubre ambos motivos en vez de afirmar "no hay carnets vigentes
    // hoy" -- que aqui seria falso y contradiria la tabla de abajo.
    const showNoScheduleProfileNotice =
        hasSelection && !loading && !error && occupancy !== null && !hasOccupancyRows && hasSales

    return (
        <div className="space-y-6 p-6">
            <div className="flex items-center justify-between">
                <Link
                    href="/admin/membresias"
                    className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver a membresias
                </Link>
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => void exportReport()}
                    disabled={!occupancy || exporting || loading}
                    className="gap-2"
                >
                    <Download className="h-4 w-4" />
                    {exporting ? "Preparando..." : "Exportar Excel"}
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Ocupacion por franja
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                    <label className="block max-w-2xl">
                        <span className="text-xs uppercase tracking-wide text-slate-500">Evento</span>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-300 p-2"
                            value={eventId}
                            onChange={(e) => setEventId(e.target.value)}
                        >
                            <option value="">Selecciona un evento…</option>
                            {events.map((event) => (
                                <option key={event.id} value={event.id}>
                                    {event.title}
                                </option>
                            ))}
                        </select>
                    </label>
                    <p className="max-w-3xl text-slate-600">
                        Consulta el catalogo completo de horarios, incluso las franjas sin inscritos,
                        usando el horario efectivo del mes actual. Los cupos libres corresponden al
                        plan completo; hoy no existe un aforo independiente por horario.
                    </p>
                </CardContent>
            </Card>

            {error ? (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            ) : null}

            {loading ? <p className="text-sm text-slate-500">Calculando…</p> : null}

            {showNoEventNotice ? (
                <p className="text-sm text-slate-500">
                    Selecciona un evento para ver su ocupacion por franja.
                </p>
            ) : null}

            {showEmptyEventNotice ? (
                <p className="text-sm text-slate-500">
                    Este evento no tiene carnets vigentes hoy: no hay ocupacion que mostrar.
                </p>
            ) : null}

            {showNoScheduleProfileNotice ? (
                <p className="text-sm text-slate-500">
                    Este evento tiene carnets vendidos (ver &quot;Cupo por plan&quot; abajo), pero
                    ninguno aporta una franja horaria hoy: puede ser porque sus planes no usan
                    horario semanal (la franja es el propio tipo de entrada, como en VMT) o porque
                    el carnet vigente no tiene un horario resuelto para hoy. Aqui no hay una matriz
                    por dia y hora que mostrar.
                </p>
            ) : null}

            {occupancy && scheduleRows.length > 0 ? (
                <>
                    <div className="grid overflow-hidden rounded-2xl bg-slate-950 text-white sm:grid-cols-3">
                        <div className="p-5 sm:border-r sm:border-white/10">
                            <p className="text-sm text-slate-300">Carnets vigentes</p>
                            <p className="mt-1 text-3xl font-semibold tabular-nums">{occupancy.currentMembers}</p>
                        </div>
                        <div className="border-t border-white/10 p-5 sm:border-r sm:border-t-0">
                            <p className="text-sm text-slate-300">Franjas con ocupacion</p>
                            <p className="mt-1 text-3xl font-semibold tabular-nums">
                                {scheduleRows.filter((row) => row.status === "SCHEDULED" && row.enrolled > 0).length}
                            </p>
                        </div>
                        <div className="border-t border-white/10 p-5 sm:border-t-0">
                            <p className="text-sm text-slate-300">Pendientes de horario</p>
                            <p className={`mt-1 text-3xl font-semibold tabular-nums ${occupancy.missingSchedule > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                                {occupancy.missingSchedule}
                            </p>
                        </div>
                    </div>

                    <Card>
                        <CardHeader className="space-y-1">
                            <CardTitle className="flex items-center gap-2">
                                <UsersRound className="h-5 w-5" />
                                Cupos por horario y frecuencia
                            </CardTitle>
                            <p className="text-sm text-slate-500">
                                {filteredScheduleRows.length} de {scheduleRows.length} filas del catalogo.
                            </p>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_14rem_16rem]">
                                <label className="relative block">
                                    <span className="sr-only">Buscar en el reporte</span>
                                    <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                                    <Input
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                        placeholder="Buscar plan, dias u horario"
                                        className="pl-9"
                                    />
                                </label>
                                <label>
                                    <span className="sr-only">Filtrar categoria</span>
                                    <select
                                        value={category}
                                        onChange={(event) => setCategory(event.target.value)}
                                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                                    >
                                        <option value="all">Todas las categorias</option>
                                        {categoryOptions.map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                                <label>
                                    <span className="sr-only">Filtrar frecuencia</span>
                                    <select
                                        value={frequency}
                                        onChange={(event) => setFrequency(event.target.value)}
                                        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                                    >
                                        <option value="all">Todas las frecuencias</option>
                                        {frequencyOptions.map((option) => <option key={option}>{option}</option>)}
                                    </select>
                                </label>
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="min-w-[1040px] w-full text-left text-sm">
                                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th className="px-4 py-3 font-semibold">Plan</th>
                                            <th className="px-4 py-3 font-semibold">Categoria</th>
                                            <th className="px-4 py-3 font-semibold">Frecuencia</th>
                                            <th className="px-4 py-3 font-semibold">Dias</th>
                                            <th className="px-4 py-3 font-semibold">Horario</th>
                                            <th className="px-4 py-3 text-right font-semibold">Ocupados</th>
                                            <th className="px-4 py-3 text-right font-semibold">Vendidos plan</th>
                                            <th className="px-4 py-3 text-right font-semibold">Libres plan</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredScheduleRows.map((row) => (
                                            <tr
                                                key={`${row.ticketTypeId}-${row.category}-${row.frequency}-${row.groupLabel}-${row.label}-${row.status}`}
                                                className={`border-t border-slate-100 ${row.status === "MISSING_SCHEDULE" ? "bg-amber-50" : "hover:bg-slate-50/70"}`}
                                            >
                                                <td className="max-w-[20rem] px-4 py-3 font-medium text-slate-900">{row.ticketTypeName}</td>
                                                <td className="px-4 py-3 text-slate-700">{row.categoryLabel}</td>
                                                <td className="px-4 py-3 text-slate-700">{row.frequencyLabel}</td>
                                                <td className="px-4 py-3 text-slate-600">{row.groupLabel}</td>
                                                <td className="whitespace-nowrap px-4 py-3 text-slate-700">{row.label}</td>
                                                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-950">{row.enrolled}</td>
                                                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.soldInPlan}</td>
                                                <td className="px-4 py-3 text-right font-medium tabular-nums text-emerald-700">
                                                    {row.availableInPlan ?? "Ilimitado"}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {filteredScheduleRows.length === 0 ? (
                                <p className="py-8 text-center text-sm text-slate-500">
                                    No hay filas que coincidan con estos filtros.
                                </p>
                            ) : null}
                        </CardContent>
                    </Card>
                </>
            ) : null}

            {planTotals.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Cupo por plan</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-sm text-slate-500">
                            Este si es un limite real: es el que se aplica al vender.
                        </p>
                        <Table
                            head={["Plan", "Vendidos", "Cupo", "Disponible"]}
                            rows={planTotals.map((plan) => [
                                plan.name,
                                String(plan.sold),
                                plan.capacity === 0 ? "sin tope" : String(plan.capacity),
                                plan.available === null ? "sin tope" : String(plan.available),
                            ])}
                        />
                    </CardContent>
                </Card>
            ) : null}

            {dayLoad.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Carga por dia y hora (todos los planes)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table
                            head={["Dia", "Franja", "Alumnos"]}
                            rows={dayLoad.map((cell) => [
                                WEEKDAY_LABEL[cell.weekday] ?? String(cell.weekday),
                                cell.label,
                                String(cell.total),
                            ])}
                        />
                    </CardContent>
                </Card>
            ) : null}

            {slots.length > 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>Detalle por plan, frecuencia y franja</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table
                            head={["Plan", "Categoria", "Frecuencia", "Dia", "Franja", "Inscritos"]}
                            rows={slots.map((slot) => [
                                slot.ticketTypeName,
                                slot.categoryLabel,
                                slot.frequencyLabel,
                                WEEKDAY_LABEL[slot.weekday] ?? String(slot.weekday),
                                slot.label,
                                String(slot.enrolled),
                            ])}
                        />
                    </CardContent>
                </Card>
            ) : null}
        </div>
    )
}

function durationLabel(months: number | null): string {
    if (months === 6) return "Semestral"
    if (months === 12) return "Anual"
    return months ? `${months} meses` : "Sin duracion fija"
}

function limaDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat("en", {
        timeZone: "America/Lima",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date)
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${value.year}-${value.month}-${value.day}`
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead>
                    <tr className="border-b border-slate-200">
                        {head.map((cell) => (
                            <th key={cell} className="py-2 pr-4 text-xs uppercase tracking-wide text-slate-500">
                                {cell}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, index) => (
                        <tr key={index} className="border-b border-slate-100">
                            {row.map((cell, cellIndex) => (
                                <td key={cellIndex} className="py-2 pr-4 text-slate-800">
                                    {cell}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
