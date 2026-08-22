"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft, BarChart3 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

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
}

interface OccupancyPayload {
    slots: SlotRow[]
    dayLoad: DayLoadCell[]
    planTotals: PlanRow[]
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
    const [events, setEvents] = useState<EventOption[]>([])
    const [eventId, setEventId] = useState("")
    const [occupancy, setOccupancy] = useState<OccupancyPayload | null>(null)
    // Cubre tanto la carga inicial (lista de eventos) como cada recalculo al
    // cambiar de evento: esta pantalla no tiene nada util que mostrar hasta
    // que responde el endpoint, asi que no hace falta distinguirlas.
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async (id: string) => {
        setLoading(true)
        setError(null)
        try {
            const query = id ? `?eventId=${id}` : ""
            const response = await fetch(`/api/admin/membership-occupancy${query}`, {
                cache: "no-store",
            })
            const payload = (await response.json()) as OccupancyApiResponse
            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error ?? "No se pudo cargar la ocupacion")
            }
            setEvents(payload.data.events)
            setOccupancy(payload.data.occupancy)
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Error inesperado")
            setOccupancy(null)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load(eventId)
    }, [eventId, load])

    const slots = occupancy?.slots ?? []
    const dayLoad = occupancy?.dayLoad ?? []
    const planTotals = occupancy?.planTotals ?? []
    const hasSelection = Boolean(eventId)
    const hasOccupancyRows = slots.length > 0 || dayLoad.length > 0
    const showNoEventNotice = !hasSelection && !loading && !error
    const showEmptyEventNotice = hasSelection && !loading && !error && occupancy !== null && !hasOccupancyRows

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
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="h-5 w-5" />
                        Ocupacion por franja
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                    <label className="block max-w-lg">
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
                    <p className="text-slate-500">
                        Cuenta los carnets que pueden entrar hoy, con el horario efectivo del mes en
                        curso. Es informativo: el unico cupo que se hace cumplir en la venta es el
                        global del tipo de entrada. No existe un tope por franja horaria.
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
