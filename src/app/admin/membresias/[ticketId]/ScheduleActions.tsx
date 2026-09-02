"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, Clock, Repeat, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { MembershipChangeBlocker, MembershipChangePlan } from "@/lib/membership-transfer"
import type { DetailCandidateType, MembershipDetail } from "./types"

// El plan exitoso (`ok: true`) de membership-transfer.ts: se reutiliza el tipo
// real en vez de duplicar su forma a mano, para no desincronizarse si el
// planificador cambia campos. Se exporta: page.tsx lo necesita para guardar
// el ultimo cambio aplicado (Tarea 10, hallazgo 2).
export type Plan = Extract<MembershipChangePlan, { ok: true }>

type Mode = "schedule" | "transfer"

export function ScheduleActions({
    detail,
    appliedChange,
    onApplied,
    sameEventOnly = false,
}: {
    detail: MembershipDetail
    // Ultimo cambio aplicado con exito para ESTE carnet, dueno de page.tsx.
    // Vive en el padre para sobrevivir a la recarga de la ficha (Tarea 10,
    // hallazgo 2): si viviera aca, el reset por `detail.ticketType.id` de mas
    // abajo lo borraria justo despues de aplicar un cambio de sede.
    appliedChange: Plan | null
    onApplied: (plan: Plan) => void
    /** En el panel de cupos solo corrige horarios dentro del evento elegido. */
    sameEventOnly?: boolean
}) {
    const hasProfile = detail.scheduleProfile !== null
    const [mode, setMode] = useState<Mode>(hasProfile ? "schedule" : "transfer")
    const [category, setCategory] = useState(detail.currentScheduleInput.category ?? "")
    const [frequency, setFrequency] = useState(detail.currentScheduleInput.frequency ?? "")
    const [hours, setHours] = useState<Record<string, string>>(detail.currentScheduleInput.hours)
    const [targetTypeId, setTargetTypeId] = useState("")
    const [reason, setReason] = useState("")
    // El plan PREVISUALIZADO, nunca el aplicado: en cuanto `send(false)` tiene
    // exito se limpia (ver mas abajo). Que este en null es, a la vez, la
    // proteccion contra doble aplicacion sin una vista previa nueva de por
    // medio -no hace falta un booleano `applied` aparte.
    const [plan, setPlan] = useState<Plan | null>(null)
    const [blockers, setBlockers] = useState<MembershipChangeBlocker[]>([])
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [occupancy, setOccupancy] = useState<Record<string, number>>({})
    const [occupancyStatus, setOccupancyStatus] = useState<"idle" | "loading" | "ready" | "error">("idle")
    const [allowOverCapacity, setAllowOverCapacity] = useState(false)

    // Token de secuencia: solo la respuesta de la peticion MAS RECIENTE puede
    // tocar el estado. Sin esto, si el admin cambia la seleccion mientras una
    // vista previa esta en vuelo, la respuesta tardia puede repoblar `plan`
    // con el resultado de una seleccion vieja que ya nadie ve en pantalla
    // (Tarea 10, hallazgo 1). Se complementa -no reemplaza- con deshabilitar
    // el formulario completo mientras `busy`.
    const requestSeqRef = useRef(0)

    // Si el carnet cambio de tipo (se aplico un cambio de sede/horario-tipo),
    // los valores locales quedan referidos al tipo VIEJO: categoria, hora,
    // lista de candidatos, y hasta si corresponde mostrar el selector en
    // cascada. Se reinicia todo desde el `detail` fresco que trae el reload.
    // La confirmacion de "aplicado" no se toca aca: la dueña es page.tsx.
    useEffect(() => {
        setMode(detail.scheduleProfile !== null ? "schedule" : "transfer")
        setCategory(detail.currentScheduleInput.category ?? "")
        setFrequency(detail.currentScheduleInput.frequency ?? "")
        setHours(detail.currentScheduleInput.hours)
        setTargetTypeId("")
        setPlan(null)
        setBlockers([])
        setError(null)
        setAllowOverCapacity(false)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail.ticketType.id])

    const candidateTypes = useMemo(
        () =>
            sameEventOnly
                ? detail.candidateTypes.filter((candidate) => candidate.sameEvent)
                : detail.candidateTypes,
        [detail.candidateTypes, sameEventOnly]
    )
    const selectedTargetType = useMemo(
        () => candidateTypes.find((candidate) => candidate.id === targetTypeId) ?? null,
        [candidateTypes, targetTypeId]
    )
    const targetIsFull = Boolean(
        selectedTargetType &&
            selectedTargetType.capacity > 0 &&
            selectedTargetType.sold >= selectedTargetType.capacity
    )

    // Ocupacion de la sede que se esta mirando, para no mandar a nadie a una
    // franja llena. Clave: "weekday|start-end".
    const occupancyEventId = useMemo(() => {
        if (mode === "schedule") return detail.event.id
        return selectedTargetType?.eventId ?? ""
    }, [mode, selectedTargetType, detail.event.id])

    useEffect(() => {
        // Se limpia de entrada: si no, mientras llega la respuesta del evento
        // NUEVO se siguen viendo los numeros del evento anterior (Tarea 10,
        // hallazgo menor).
        setOccupancy({})
        setOccupancyStatus(occupancyEventId ? "loading" : "idle")
        if (!occupancyEventId) return
        let cancelled = false
        void (async () => {
            try {
                const response = await fetch(
                    `/api/admin/membership-occupancy?eventId=${occupancyEventId}`,
                    { cache: "no-store" }
                )
                if (!response.ok) throw new Error("No se pudo cargar la ocupacion")
                const payload = await response.json()
                if (cancelled) return
                if (!payload.success || !payload.data.occupancy) {
                    throw new Error("No se pudo cargar la ocupacion")
                }
                const map: Record<string, number> = {}
                for (const cell of payload.data.occupancy.dayLoad) {
                    map[`${cell.weekday}|${cell.start}-${cell.end}`] = cell.total
                }
                setOccupancy(map)
                setOccupancyStatus("ready")
            } catch {
                if (!cancelled) setOccupancyStatus("error")
            }
        })()
        return () => {
            cancelled = true
        }
    }, [occupancyEventId])

    // La cascada de horas y la ocupacion tienen que mirar el catalogo del
    // tipo que de verdad va a regir despues del cambio: en "schedule" es el
    // tipo ACTUAL (se edita en el sitio); en "transfer" es el tipo DESTINO
    // elegido -sus horas pueden no tener nada que ver con las del origen
    // (Tarea 10, hallazgo 3). Sin destino elegido no hay cascada que mostrar,
    // igual que cuando el destino no tiene catalogo (la franja ES el tipo).
    const activeProfile =
        mode === "transfer" ? (selectedTargetType?.scheduleProfile ?? null) : detail.scheduleProfile
    const activeCategory = activeProfile?.categories.find((c) => c.id === category) ?? null
    const activeFrequency = activeCategory?.frequencies.find((f) => f.id === frequency) ?? null

    // Cualquier cambio en el formulario invalida la vista previa: el plan (y
    // la huella que trae adentro) dejan de corresponder a lo que se va a
    // mandar. No se reinicia el motivo: no cambia lo que se escribiria.
    const reset = () => {
        setPlan(null)
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
            allowOverCapacity,
        }
    }

    const send = async (preview: boolean) => {
        const seq = ++requestSeqRef.current
        setBusy(true)
        setBlockers([])
        setError(null)
        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body(preview)),
            })
            let payload: {
                success: boolean
                data?: { plan: Plan }
                blockers?: MembershipChangeBlocker[]
                error?: string
            }
            try {
                payload = await response.json()
            } catch {
                // Respuesta no-JSON (por ejemplo una pagina de error HTML):
                // sin esto, response.json() revienta con un SyntaxError del
                // navegador en ingles (Tarea 10, hallazgo menor).
                if (seq !== requestSeqRef.current) return
                setError("No se pudo interpretar la respuesta del servidor.")
                setPlan(null)
                return
            }
            // Ignora respuestas obsoletas: una peticion mas nueva ya esta en
            // vuelo o ya resolvio (Tarea 10, hallazgo 1).
            if (seq !== requestSeqRef.current) return
            if (!payload.success) {
                // Bloqueo de reglas de negocio: 409 con `blockers`, SIN
                // `error`. Cada mensaje ya viene en espanol y redactado para
                // el admin, se muestra tal cual. Un fallo de verdad (500, u
                // otro rechazo previo a la planificacion) trae `error` en su
                // lugar y no `blockers`. Un `blockers` vacio (no deberia
                // pasar, pero si pasa) no debe dejar la pantalla muda: cae al
                // mensaje generico.
                if (Array.isArray(payload.blockers) && payload.blockers.length > 0) {
                    setBlockers(payload.blockers)
                } else {
                    setError(payload.error ?? "No se pudo completar la operacion.")
                }
                setPlan(null)
                return
            }
            const resultPlan = (payload.data as { plan: Plan }).plan
            if (preview) {
                setPlan(resultPlan)
            } else {
                // Se limpia el plan: ya se aplico, y sin un plan en pantalla
                // "Aplicar cambio" queda deshabilitado hasta la proxima vista
                // previa. La confirmacion (con el plan REPLANIFICADO que de
                // verdad se escribio dentro de la transaccion) la guarda el
                // padre, que sobrevive a la recarga de la ficha.
                setPlan(null)
                onApplied(resultPlan)
            }
        } catch (err) {
            if (seq !== requestSeqRef.current) return
            setError(err instanceof Error ? err.message : "Error de red")
            setPlan(null)
        } finally {
            if (seq === requestSeqRef.current) setBusy(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Repeat className="h-5 w-5" />
                    {sameEventOnly ? "Cambiar horario del asistente" : "Corregir horario o sede"}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm" aria-busy={busy}>
                <div className="flex gap-2">
                    {hasProfile ? (
                        <Button
                            variant={mode === "schedule" ? "default" : "outline"}
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                                setMode("schedule")
                                reset()
                            }}
                        >
                            Horario semanal
                        </Button>
                    ) : null}
                    {!sameEventOnly || !hasProfile ? <Button
                        variant={mode === "transfer" ? "default" : "outline"}
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                            setMode("transfer")
                            reset()
                        }}
                    >
                        {hasProfile ? "Cambiar de sede" : "Cambiar de horario (tipo de entrada)"}
                    </Button> : null}
                </div>

                {mode === "transfer" ? (
                    <label className="block">
                        <span className="text-xs uppercase tracking-wide text-slate-500">
                            {sameEventOnly ? "Horario o dias destino" : "Tipo de entrada destino"}
                        </span>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-300 p-2"
                            value={targetTypeId}
                            disabled={busy}
                            onChange={(e) => {
                                setTargetTypeId(e.target.value)
                                // El catalogo de horas del nuevo destino no
                                // tiene por que parecerse al del anterior
                                // (Tarea 10, hallazgo 3): se limpia la
                                // cascada en vez de arrastrar una seleccion
                                // que puede no existir alla.
                                setCategory("")
                                setFrequency("")
                                setHours({})
                                setAllowOverCapacity(false)
                                reset()
                            }}
                        >
                            <option value="">Selecciona…</option>
                            {candidateTypes.map((type: DetailCandidateType) => (
                                <option key={type.id} value={type.id}>
                                    {type.sameEvent ? "" : `${type.eventTitle} · `}
                                    {type.name} ({type.sold}
                                    {type.capacity > 0 ? `/${type.capacity}` : ""} vendidos)
                                </option>
                            ))}
                        </select>
                        {candidateTypes.length === 0 ? (
                            <p className="mt-1 text-slate-500">
                                No hay horarios equivalentes en este evento para la frecuencia comprada.
                            </p>
                        ) : null}
                    </label>
                ) : null}

                {mode === "transfer" && selectedTargetType ? (
                    <div className="grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ocupados</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">
                                {selectedTargetType.sold}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Cupo</p>
                            <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">
                                {selectedTargetType.capacity === 0 ? "Sin tope" : selectedTargetType.capacity}
                            </p>
                        </div>
                        <div>
                            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Disponibles</p>
                            <p className={`mt-1 text-xl font-semibold tabular-nums ${targetIsFull ? "text-red-700" : "text-emerald-700"}`}>
                                {selectedTargetType.capacity === 0
                                    ? "Sin tope"
                                    : Math.max(selectedTargetType.capacity - selectedTargetType.sold, 0)}
                            </p>
                        </div>
                    </div>
                ) : null}

                {mode === "transfer" && targetIsFull ? (
                    <label className="flex cursor-pointer gap-3 rounded-xl bg-amber-50 p-4 text-amber-950 ring-1 ring-amber-200">
                        <input
                            type="checkbox"
                            checked={allowOverCapacity}
                            disabled={busy}
                            onChange={(event) => {
                                setAllowOverCapacity(event.target.checked)
                                reset()
                            }}
                            className="mt-1 h-4 w-4 rounded border-amber-400 text-amber-700 focus:ring-amber-600"
                        />
                        <span>
                            <span className="flex items-center gap-2 font-semibold">
                                <ShieldAlert className="h-4 w-4" />
                                Autorizar sobrecupo de una persona
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-amber-800">
                                El destino quedara con {selectedTargetType ? selectedTargetType.sold + 1 : "â€”"} inscritos
                                para un cupo de {selectedTargetType?.capacity}. La excepcion y el motivo quedaran en el historial.
                            </span>
                        </span>
                    </label>
                ) : null}

                {activeProfile ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                            <span className="text-xs uppercase tracking-wide text-slate-500">Categoria</span>
                            <select
                                className="mt-1 w-full rounded-md border border-slate-300 p-2"
                                value={category}
                                disabled={busy}
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
                                disabled={busy || !activeCategory}
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
                                    disabled={busy}
                                    onChange={(e) => {
                                        setHours({ ...hours, [group.id]: e.target.value })
                                        reset()
                                    }}
                                >
                                    <option value="">Selecciona…</option>
                                    {group.hours.map((hour) => {
                                        const value = `${hour.start}-${hour.end}`
                                        // Peor caso entre TODOS los dias del
                                        // grupo, no solo el primero: en un
                                        // grupo multi-dia (ej. PLATA L-V) solo
                                        // mirar weekdays[0] subestima el dia
                                        // mas lleno (Tarea 10, hallazgo menor).
                                        const load = group.weekdays.reduce(
                                            (max, weekday) =>
                                                Math.max(max, occupancy[`${weekday}|${value}`] ?? 0),
                                            0
                                        )
                                        return (
                                            <option key={value} value={value}>
                                                {hour.start} - {hour.end}
                                                {occupancyStatus === "loading"
                                                    ? " · cargando cupo…"
                                                    : occupancyStatus === "error"
                                                      ? " · cupo no disponible"
                                                      : occupancyStatus === "ready"
                                                        ? ` · ${load} en la franja`
                                                        : ""}
                                            </option>
                                        )
                                    })}
                                </select>
                            </label>
                        ))}
                    </div>
                ) : null}
                {activeProfile && occupancyStatus === "error" ? (
                    <p role="alert" className="rounded-lg bg-amber-50 p-3 text-amber-900">
                        No se pudo consultar la ocupacion por franja. Recarga antes de confirmar el cambio.
                    </p>
                ) : null}

                <label className="block" htmlFor="membership-change-reason">
                    <span className="text-xs uppercase tracking-wide text-slate-500">
                        Motivo (queda en el historial)
                    </span>
                    <Input
                        id="membership-change-reason"
                        value={reason}
                        disabled={busy}
                        required
                        aria-describedby="membership-change-reason-help"
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Ej. Solicitud del apoderado por cambio de turno"
                        className="mt-1"
                    />
                    <span id="membership-change-reason-help" className="mt-1 block text-xs text-slate-500">
                        Minimo 5 caracteres; si autorizas sobrecupo, minimo 10.
                    </span>
                </label>

                {blockers.length > 0 ? (
                    <div role="alert" className="space-y-2 rounded-lg bg-red-50 p-3 text-red-800">
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
                    <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-red-800">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </p>
                ) : null}

                {appliedChange ? (
                    <div aria-live="polite" className="space-y-2 rounded-lg border border-sky-200 bg-sky-50 p-3">
                        <p className="font-medium text-sky-900">Aplicado · {appliedChange.label}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <PlanColumn title="Antes" state={appliedChange.before} tone="sky" />
                            <PlanColumn title="Despues" state={appliedChange.after} tone="sky" />
                        </div>
                    </div>
                ) : null}

                {plan ? (
                    <div aria-live="polite" className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                        <p className="flex flex-wrap items-center gap-2 font-medium text-emerald-900">
                            {plan.label}
                            {plan.overCapacityOverride ? (
                                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-950">
                                    Sobrecupo +1
                                </span>
                            ) : null}
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <PlanColumn title="Antes" state={plan.before} tone="emerald" />
                            <PlanColumn title="Despues" state={plan.after} tone="emerald" />
                        </div>
                    </div>
                ) : null}

                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        disabled={
                            busy ||
                            (activeProfile !== null && occupancyStatus !== "ready") ||
                            (mode === "transfer" && (!targetTypeId || (targetIsFull && !allowOverCapacity)))
                        }
                        onClick={() => void send(true)}
                    >
                        Previsualizar
                    </Button>
                    <Button
                        disabled={
                            busy ||
                            plan === null ||
                            (activeProfile !== null && occupancyStatus !== "ready") ||
                            reason.trim().length < (plan?.overCapacityOverride ? 10 : 5)
                        }
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
