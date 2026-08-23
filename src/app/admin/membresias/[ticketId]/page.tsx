"use client"

import { use, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertCircle, ArrowLeft, CalendarClock, History, MapPin, RefreshCw } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScheduleActions, type Plan } from "./ScheduleActions"
import type { MembershipDetail } from "./types"

const ACCESS_LABEL: Record<MembershipDetail["diagnosis"]["accessStatus"], string> = {
    OK: "QR activo",
    NOT_STARTED: "Aun no inicia",
    EXPIRED: "Vencida",
    BLACKOUT: "Mes sin actividad",
    FROZEN: "Congelada",
    NOT_APPLICABLE: "Sin vigencia fija",
}

const ACCESS_TONE: Record<MembershipDetail["diagnosis"]["accessStatus"], string> = {
    OK: "bg-emerald-100 text-emerald-800",
    NOT_STARTED: "bg-amber-100 text-amber-800",
    EXPIRED: "bg-red-100 text-red-800",
    BLACKOUT: "bg-slate-100 text-slate-700",
    FROZEN: "bg-sky-100 text-sky-800",
    NOT_APPLICABLE: "bg-slate-100 text-slate-700",
}

type ScanResultCode = MembershipDetail["diagnosis"]["recentScans"][number]["result"]

const SCAN_RESULT_LABEL: Record<ScanResultCode, string> = {
    VALID: "Ingreso OK",
    INVALID: "Rechazado",
    ALREADY_USED: "Ya habia ingresado",
    WRONG_DAY: "Dia u hora que no le toca",
    WRONG_EVENT: "Sede o evento equivocado",
    EXPIRED: "Vencido",
}

const SCAN_RESULT_TONE: Record<ScanResultCode, string> = {
    VALID: "bg-emerald-100 text-emerald-800",
    INVALID: "bg-red-100 text-red-800",
    ALREADY_USED: "bg-amber-100 text-amber-800",
    WRONG_DAY: "bg-amber-100 text-amber-800",
    WRONG_EVENT: "bg-red-100 text-red-800",
    EXPIRED: "bg-red-100 text-red-800",
}

export default function MembershipDetailPage({
    params,
}: {
    params: Promise<{ ticketId: string }>
}) {
    const { ticketId } = use(params)
    const [detail, setDetail] = useState<MembershipDetail | null>(null)
    // Solo cubre la carga INICIAL (todavia no hay nada que pintar). Las
    // recargas posteriores (boton "Actualizar", o tras aplicar un cambio) son
    // en segundo plano: si reusaran esta bandera, la ficha entera se
    // reemplazaria por "Cargando carnet…" y desmontaria ScheduleActions antes
    // de que el admin llegue a ver la confirmacion del cambio que acaba de
    // aplicar (Tarea 10, hallazgo 2).
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // Ultimo cambio aplicado con exito para este carnet. Vive aca (no dentro
    // de ScheduleActions) precisamente para sobrevivir a la recarga de la
    // ficha: un cambio de sede cambia `detail.ticketType.id`, y el efecto de
    // reset de ScheduleActions limpiaria cualquier estado de confirmacion que
    // viviera adentro.
    const [appliedChange, setAppliedChange] = useState<Plan | null>(null)

    const load = useCallback(async () => {
        setRefreshing(true)
        setError(null)
        try {
            const response = await fetch(`/api/admin/memberships/${ticketId}`, { cache: "no-store" })
            const payload = await response.json()
            if (!payload.success) throw new Error(payload.error ?? "No se pudo cargar el carnet")
            setDetail(payload.data as MembershipDetail)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error desconocido")
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [ticketId])

    useEffect(() => {
        void load()
    }, [load])

    // Un carnet nuevo (navegacion a otro ticketId) no deberia arrastrar la
    // confirmacion del carnet anterior.
    useEffect(() => {
        setAppliedChange(null)
    }, [ticketId])

    if (loading) return <div className="p-6 text-sm text-slate-500">Cargando carnet…</div>
    if (error && !detail) {
        return (
            <div className="p-6">
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-4 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            </div>
        )
    }
    if (!detail) return null

    const { ticket, event, ticketType, order, diagnosis, history } = detail

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
                <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load()}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                    Actualizar
                </Button>
            </div>

            {error ? (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </div>
            ) : null}

            {/* 1. Quien es y que compro */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5" />
                        {ticket.attendeeName ?? ticket.user.name ?? "Sin nombre"}
                    </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Codigo" value={ticket.ticketCode} />
                    <Field label="DNI" value={ticket.attendeeDni ?? "—"} />
                    <Field label="Matricula" value={ticket.matricula ?? "—"} />
                    <Field label="Evento" value={`${event.title} (sede ${event.sucursalCode ?? "—"})`} />
                    <Field label="Plan" value={ticketType.name} />
                    <Field
                        label="Duracion"
                        value={
                            ticketType.membershipDurationMonths
                                ? `${ticketType.membershipDurationMonths} meses`
                                : "—"
                        }
                    />
                    <Field label="Inicio" value={ticket.membershipStartDate ?? "—"} />
                    <Field
                        label="Origen"
                        value={
                            order.invoicing.kind === "boleta"
                                ? `Web · boleta ${order.invoicing.invoiceNumber ?? "pendiente"}`
                                : order.invoicing.label
                        }
                    />
                    <Field label="Total" value={`S/ ${order.totalAmount.toFixed(2)}`} />
                </CardContent>
            </Card>

            {/* 2. Que ve el alumno hoy */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <CalendarClock className="h-5 w-5" />
                        Que ve el alumno hoy ({diagnosis.today})
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                    <div>
                        <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${ACCESS_TONE[diagnosis.accessStatus]}`}
                        >
                            {ACCESS_LABEL[diagnosis.accessStatus]}
                        </span>
                        {diagnosis.frozenMonth ? (
                            <span className="ml-2 text-slate-600">Congelada en {diagnosis.frozenMonth}</span>
                        ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <Field
                            label="Vigencia"
                            // En NOT_APPLICABLE (carnet legacy sin ancla de
                            // termino fijo) las dos fechas llegan vacias:
                            // pintarlas dejaba una flecha sola sin explicacion.
                            value={
                                diagnosis.startStr && diagnosis.expiryStr
                                    ? `${diagnosis.startStr} → ${diagnosis.expiryStr}`
                                    : "Sin vigencia calculada (carnet sin termino fijo)"
                            }
                        />
                        <Field
                            label="Mes en curso"
                            value={
                                diagnosis.periodStart
                                    ? `#${(diagnosis.monthIndex ?? 0) + 1} · ${diagnosis.periodStart} → ${diagnosis.periodEnd}`
                                    : "—"
                            }
                        />
                        <Field
                            label="Clases del mes"
                            value={`${diagnosis.attendance.used} de ${diagnosis.attendance.total} (quedan ${diagnosis.attendance.remaining})`}
                        />
                        <Field
                            label="Horario efectivo del mes"
                            value={diagnosis.effectiveScheduleSummary}
                        />
                        <Field label="Horario base (checkout)" value={diagnosis.baseScheduleSummary} />
                        <Field
                            label="Cambios de horario por mes"
                            value={
                                diagnosis.monthlyScheduleCount > 0
                                    ? `${diagnosis.monthlyScheduleCount} definidos`
                                    : "ninguno"
                            }
                        />
                    </div>
                    {diagnosis.monthlyScheduleCount > 0 ? (
                        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
                            Este carnet tiene horarios definidos por mes. Mientras los tenga, el panel no
                            deja cambiar el horario base ni la sede: hay que resolverlo por script.
                        </p>
                    ) : null}

                    {/* Lo que de verdad paso en la puerta, no lo que deberia
                        pasar: un carnet que "esta bien" pero acumula WRONG_DAY
                        es exactamente el que hay que corregir. */}
                    <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">
                            Ultimos escaneos
                        </p>
                        {diagnosis.recentScans.length === 0 ? (
                            <p className="mt-1 text-slate-500">Este carnet nunca se escaneo.</p>
                        ) : (
                            <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
                                {diagnosis.recentScans.map((scan) => (
                                    <li
                                        key={scan.id}
                                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                                    >
                                        <span className="text-slate-700">
                                            {new Date(scan.scannedAt).toLocaleString("es-PE")}
                                        </span>
                                        <span
                                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${SCAN_RESULT_TONE[scan.result]}`}
                                        >
                                            {SCAN_RESULT_LABEL[scan.result]}
                                        </span>
                                        {scan.notes ? (
                                            <span className="text-slate-500">{scan.notes}</span>
                                        ) : null}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* 3. Acciones */}
            <ScheduleActions
                detail={detail}
                appliedChange={appliedChange}
                onApplied={(plan) => {
                    // Se guarda ANTES de recargar: la recarga es en segundo
                    // plano (no desmonta esta seccion), pero si el fetch
                    // demora, el admin ve la confirmacion de inmediato en vez
                    // de esperar al round-trip.
                    setAppliedChange(plan)
                    void load()
                }}
            />

            {/* 4. Historial */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <History className="h-5 w-5" />
                        Historial de correcciones
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {history.length === 0 ? (
                        <p className="text-sm text-slate-500">Sin correcciones registradas.</p>
                    ) : (
                        <ul className="space-y-3 text-sm">
                            {history.map((row) => (
                                <li key={row.id} className="rounded-lg border border-slate-200 p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline">
                                            {row.kind === "SCHEDULE" ? "Horario" : "Tipo / sede"}
                                        </Badge>
                                        <span className="text-slate-500">
                                            {new Date(row.createdAt).toLocaleString("es-PE")} ·{" "}
                                            {row.actor.name ?? row.actor.email}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-slate-700">
                                        {row.before.ticketTypeName} · {row.before.scheduleSummary}
                                        {" → "}
                                        {row.after.ticketTypeName} · {row.after.scheduleSummary}
                                    </p>
                                    <p className="mt-1 text-slate-500">Motivo: {row.reason}</p>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-0.5 text-slate-900">{value}</p>
        </div>
    )
}
