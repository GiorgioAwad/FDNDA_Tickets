"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Repeat } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { MembershipChangeBlocker, MembershipChangePlan } from "@/lib/membership-transfer"
import type { DetailCandidateType, MembershipDetail } from "./types"

// El plan exitoso (`ok: true`) de membership-transfer.ts: se reutiliza el tipo
// real en vez de duplicar su forma a mano, para no desincronizarse si el
// planificador cambia campos.
type Plan = Extract<MembershipChangePlan, { ok: true }>

type Mode = "schedule" | "transfer"

export function ScheduleActions({
    detail,
    onApplied,
}: {
    detail: MembershipDetail
    onApplied: () => void
}) {
    const hasProfile = detail.scheduleProfile !== null
    const [mode, setMode] = useState<Mode>(hasProfile ? "schedule" : "transfer")
    const [category, setCategory] = useState(detail.currentScheduleInput.category ?? "")
    const [frequency, setFrequency] = useState(detail.currentScheduleInput.frequency ?? "")
    const [hours, setHours] = useState<Record<string, string>>(detail.currentScheduleInput.hours)
    const [targetTypeId, setTargetTypeId] = useState("")
    const [reason, setReason] = useState("")
    // El plan previsualizado (o, tras aplicar, el REPLANIFICADO que de verdad
    // se escribio). `applied` distingue una cosa de la otra para no dejar
    // aplicar dos veces el mismo plan sin una vista previa nueva de por medio.
    const [plan, setPlan] = useState<Plan | null>(null)
    const [applied, setApplied] = useState(false)
    const [blockers, setBlockers] = useState<MembershipChangeBlocker[]>([])
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [occupancy, setOccupancy] = useState<Record<string, number>>({})

    // Si el carnet cambio de tipo (se aplico un cambio de sede/horario-tipo),
    // los valores locales quedan referidos al tipo VIEJO: categoria, hora,
    // lista de candidatos, y hasta si corresponde mostrar el selector en
    // cascada. Se reinicia todo desde el `detail` fresco que trae el reload.
    useEffect(() => {
        setMode(detail.scheduleProfile !== null ? "schedule" : "transfer")
        setCategory(detail.currentScheduleInput.category ?? "")
        setFrequency(detail.currentScheduleInput.frequency ?? "")
        setHours(detail.currentScheduleInput.hours)
        setTargetTypeId("")
        setPlan(null)
        setApplied(false)
        setBlockers([])
        setError(null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail.ticketType.id])

    // Ocupacion de la sede que se esta mirando, para no mandar a nadie a una
    // franja llena. Clave: "weekday|start-end".
    const occupancyEventId = useMemo(() => {
        if (mode === "schedule") return detail.event.id
        return detail.candidateTypes.find((t) => t.id === targetTypeId)?.eventId ?? ""
    }, [mode, targetTypeId, detail])

    useEffect(() => {
        if (!occupancyEventId) return
        let cancelled = false
        void (async () => {
            const response = await fetch(
                `/api/admin/membership-occupancy?eventId=${occupancyEventId}`,
                { cache: "no-store" }
            )
            const payload = await response.json()
            if (cancelled || !payload.success || !payload.data.occupancy) return
            const map: Record<string, number> = {}
            for (const cell of payload.data.occupancy.dayLoad) {
                map[`${cell.weekday}|${cell.start}-${cell.end}`] = cell.total
            }
            setOccupancy(map)
        })()
        return () => {
            cancelled = true
        }
    }, [occupancyEventId])

    const activeProfile = detail.scheduleProfile
    const activeCategory = activeProfile?.categories.find((c) => c.id === category) ?? null
    const activeFrequency = activeCategory?.frequencies.find((f) => f.id === frequency) ?? null

    // Cualquier cambio en el formulario invalida la vista previa: el plan (y
    // la huella que trae adentro) dejan de corresponder a lo que se va a
    // mandar. No se reinicia el motivo: no cambia lo que se escribiria.
    const reset = () => {
        setPlan(null)
        setApplied(false)
        setBlockers([])
        setError(null)
    }

    const endpoint =
        mode === "schedule"
            ? `/api/admin/memberships/${detail.ticket.id}/schedule`
            : `/api/admin/memberships/${detail.ticket.id}/transfer`

    const body = (preview: boolean) => {
        const common = { preview, reason }
        // La huella de la vista previa solo se reenvia al aplicar: es lo que
        // deja al servidor abortar si el carnet cambio entre que se
        // previsualizo y este click. En la vista previa todavia no hay nada
        // que proteger.
        const fingerprintField = !preview && plan ? { fingerprint: plan.fingerprint } : {}
        if (mode === "schedule") {
            return { ...common, ...fingerprintField, selection: { category, frequency, hours } }
        }
        return {
            ...common,
            ...fingerprintField,
            targetTicketTypeId: targetTypeId,
            selection: category && frequency ? { category, frequency, hours } : undefined,
        }
    }

    const send = async (preview: boolean) => {
        setBusy(true)
        setBlockers([])
        setError(null)
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body(preview)),
            })
            const payload = await response.json()
            if (!payload.success) {
                // Bloqueo de reglas de negocio: 409 con `blockers`, SIN
                // `error`. Cada mensaje ya viene en espanol y redactado para
                // el admin, se muestra tal cual. Un fallo de verdad (500, u
                // otro rechazo previo a la planificacion) trae `error` en su
                // lugar y no `blockers`.
                if (Array.isArray(payload.blockers)) {
                    setBlockers(payload.blockers)
                } else {
                    setError(payload.error ?? "No se pudo completar la operacion")
                }
                setPlan(null)
                setApplied(false)
                return
            }
            const resultPlan = payload.data.plan as Plan
            setPlan(resultPlan)
            if (preview) {
                setApplied(false)
            } else {
                // La respuesta trae el plan REPLANIFICADO dentro de la
                // transaccion -el que de verdad se escribio-, no el de esta
                // vista previa: se muestra ese.
                setApplied(true)
                onApplied()
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error de red")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Repeat className="h-5 w-5" />
                    Corregir horario o sede
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
                <div className="flex gap-2">
                    {hasProfile ? (
                        <Button
                            variant={mode === "schedule" ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                                setMode("schedule")
                                reset()
                            }}
                        >
                            Horario semanal
                        </Button>
                    ) : null}
                    <Button
                        variant={mode === "transfer" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                            setMode("transfer")
                            reset()
                        }}
                    >
                        {hasProfile ? "Cambiar de sede" : "Cambiar de horario (tipo de entrada)"}
                    </Button>
                </div>

                {mode === "transfer" ? (
                    <label className="block">
                        <span className="text-xs uppercase tracking-wide text-slate-500">
                            Tipo de entrada destino
                        </span>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-300 p-2"
                            value={targetTypeId}
                            onChange={(e) => {
                                setTargetTypeId(e.target.value)
                                reset()
                            }}
                        >
                            <option value="">Selecciona…</option>
                            {detail.candidateTypes.map((type: DetailCandidateType) => (
                                <option key={type.id} value={type.id}>
                                    {type.sameEvent ? "" : `${type.eventTitle} · `}
                                    {type.name} ({type.sold}
                                    {type.capacity > 0 ? `/${type.capacity}` : ""} vendidos)
                                </option>
                            ))}
                        </select>
                        {detail.candidateTypes.length === 0 ? (
                            <p className="mt-1 text-slate-500">
                                No hay tipos equivalentes disponibles (mismo precio, duracion, cupo mensual
                                y plan).
                            </p>
                        ) : null}
                    </label>
                ) : null}

                {activeProfile ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Categoria</span>
                            <select
                                className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                value={category}
                                onChange={(e) => {
                                    setCategory(e.target.value)
                                    setFrequency("")
                                    setHours({})
                                    reset()
                                }}
                            >
                                <option value="">Selecciona…</option>
                                {activeProfile.categories.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="block">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Frecuencia</span>
                            <select
                                className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                value={frequency}
                                disabled={!activeCategory}
                                onChange={(e) => {
                                    setFrequency(e.target.value)
                                    setHours({})
                                    reset()
                                }}
                            >
                                <option value="">Selecciona…</option>
                                {activeCategory?.frequencies.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {activeFrequency?.dayGroups.map((group) => (
                            <label key={group.id} className="block">
                                <span className="text-xs uppercase tracking-wide text-slate-500">
                                    <Clock className="mr-1 inline h-3 w-3" />
                                    {group.label}
                                </span>
                                <select
                                    className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                    value={hours[group.id] ?? ""}
                                    onChange={(e) => {
                                        setHours({ ...hours, [group.id]: e.target.value })
                                        reset()
                                    }}
                                >
                                    <option value="">Selecciona…</option>
                                    {group.hours.map((hour) => {
                                        const value = `${hour.start}-${hour.end}`
                                        const load = occupancy[`${group.weekdays[0]}|${value}`] ?? 0
                                        return (
                                            <option key={value} value={value}>
                                                {hour.start} - {hour.end} · {load} en la franja
                                            </option>
                                        )
                                    })}
                                </select>
                            </label>
                        ))}
                    </div>
                ) : null}

                <label className="block">
                    <span className="text-xs uppercase tracking-wide text-slate-500">
                        Motivo (queda en el historial)
                    </span>
                    <Input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Ej. compro CDM por error, asiste en VIDENA"
                        className="mt-1"
                    />
                </label>

                {blockers.length > 0 ? (
                    <div className="space-y-2 rounded-lg bg-red-50 p-3 text-red-800">
                        <p className="flex items-center gap-2 font-medium">
                            <AlertTriangle className="h-4 w-4" />
                            No se puede aplicar
                        </p>
                        <ul className="list-inside list-disc space-y-1">
                            {blockers.map((blocker) => (
                                <li key={blocker.code}>{blocker.message}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}

                {error ? (
                    <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-800">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </p>
                ) : null}

                {plan ? (
                    <div
                        className={
                            applied
                                ? "space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3"
                                : "space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
                        }
                    >
                        <p className={`font-medium ${applied ? "text-sky-900" : "text-emerald-900"}`}>
                            {applied ? `Aplicado · ${plan.label}` : plan.label}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <PlanColumn title="Antes" state={plan.before} tone={applied ? "sky" : "emerald"} />
                            <PlanColumn title="Despues" state={plan.after} tone={applied ? "sky" : "emerald"} />
                        </div>
                    </div>
                ) : null}

                <div className="flex gap-2">
                    <Button variant="outline" disabled={busy} onClick={() => void send(true)}>
                        Previsualizar
                    </Button>
                    <Button
                        disabled={busy || plan === null || applied || reason.trim().length < 5}
                        onClick={() => void send(false)}
                    >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Aplicar cambio
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}

function PlanColumn({
    title,
    state,
    tone,
}: {
    title: string
    state: Plan["before"]
    tone: "emerald" | "sky"
}) {
    return (
        <div>
            <p
                className={`text-xs uppercase tracking-wide ${
                    tone === "sky" ? "text-sky-700" : "text-emerald-700"
                }`}
            >
                {title}
            </p>
            <p className="text-slate-900">{state.ticketTypeName}</p>
            <p className="text-slate-600">Sede {state.sucursalCode ?? "—"}</p>
            <p className="text-slate-600">{state.scheduleSummary}</p>
            <p className="text-slate-500">
                Vendidos origen {state.sourceSold}
                {state.targetSold !== null ? ` · destino ${state.targetSold}` : ""}
            </p>
        </div>
    )
}
