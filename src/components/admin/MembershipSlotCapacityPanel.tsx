"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, CheckCircle2, Clock3, Loader2, RotateCcw, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatTime12h } from "@/lib/membership-schedule"
import { summarizeMembershipSlotsByStudent } from "@/lib/membership-slot-capacity"
import type { MembershipSlotInventoryReport, MembershipSlotInventoryRow } from "@/lib/membership-slot-inventory"

interface ApiResponse<T> {
    success: boolean
    error?: string
    data?: T
}

/**
 * Cupos por horario de los planes que limitan cupo por franja (preventa de
 * verano): muestra pagados / pendientes / libres por hora y permite editar el
 * cupo de cada franja. El servidor rechaza bajar un cupo por debajo de lo
 * reservado.
 */
export function MembershipSlotCapacityPanel({ eventId, onSaved }: { eventId: string; onSaved?: () => void }) {
    const [plans, setPlans] = useState<MembershipSlotInventoryReport[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const requestIdRef = useRef(0)

    const load = useCallback(async () => {
        const requestId = ++requestIdRef.current
        setLoading(true)
        setError(null)
        try {
            const response = await fetch(`/api/admin/membership-slot-capacities?eventId=${encodeURIComponent(eventId)}`, { cache: "no-store" })
            const payload = (await response.json()) as ApiResponse<{ plans: MembershipSlotInventoryReport[] }>
            if (requestId !== requestIdRef.current) return
            if (!response.ok || !payload.success || !payload.data) throw new Error(payload.error ?? "No se pudieron cargar los cupos por horario")
            setPlans(payload.data.plans)
        } catch (loadError) {
            if (requestId !== requestIdRef.current) return
            setPlans([])
            setError(loadError instanceof Error ? loadError.message : "Error inesperado")
        } finally {
            if (requestId === requestIdRef.current) setLoading(false)
        }
    }, [eventId])

    useEffect(() => {
        void load()
    }, [load])

    if (loading && plans.length === 0) {
        return <p className="text-sm text-slate-500">Cargando cupos por horario…</p>
    }
    if (error) {
        return (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4" />
                {error}
            </div>
        )
    }
    if (plans.length === 0) return null

    return (
        <>
            {plans.map((plan) => (
                <PlanSlotCapacityCard
                    key={plan.ticketTypeId}
                    plan={plan}
                    onSaved={(next) => {
                        setPlans((current) => current.map((p) => (p.ticketTypeId === next.ticketTypeId ? next : p)))
                        onSaved?.()
                    }}
                    onReload={() => void load()}
                    reloading={loading}
                />
            ))}
        </>
    )
}

function PlanSlotCapacityCard({
    plan,
    onSaved,
    onReload,
    reloading,
}: {
    plan: MembershipSlotInventoryReport
    onSaved: (plan: MembershipSlotInventoryReport) => void
    onReload: () => void
    reloading: boolean
}) {
    const initialDraft = useMemo(
        () => Object.fromEntries(plan.slots.map((slot) => [slot.key, String(slot.capacity)])),
        [plan]
    )
    const [draft, setDraft] = useState<Record<string, string>>(initialDraft)
    const [saving, setSaving] = useState(false)
    const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

    useEffect(() => {
        setDraft(initialDraft)
    }, [initialDraft])

    const parsed = (slot: MembershipSlotInventoryRow): number | null => {
        const raw = (draft[slot.key] ?? "").trim()
        if (!/^\d{1,3}$/.test(raw)) return null
        return Number(raw)
    }
    const changedKeys = plan.slots.filter((slot) => parsed(slot) !== slot.capacity).map((slot) => slot.key)
    const invalidSlots = plan.slots.filter((slot) => {
        const value = parsed(slot)
        return value === null || value < slot.paid + slot.pending
    })
    // En alumnos: un niño M-J-S ocupa una franja Mar/Jue y otra de sábado.
    const totals = summarizeMembershipSlotsByStudent(
        plan.slots.map((slot) => ({ ...slot, capacity: parsed(slot) ?? slot.capacity }))
    )
    const categories = [...new Set(plan.slots.map((slot) => slot.categoryLabel))]
    const showGroup = new Set(plan.slots.map((slot) => `${slot.frequencyLabel} · ${slot.groupLabel}`)).size > 1

    const save = async () => {
        if (changedKeys.length === 0 || invalidSlots.length > 0) return
        setSaving(true)
        setMessage(null)
        try {
            const capacities = Object.fromEntries(
                plan.slots.filter((slot) => changedKeys.includes(slot.key)).map((slot) => [slot.key, parsed(slot)])
            )
            const response = await fetch("/api/admin/membership-slot-capacities", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ticketTypeId: plan.ticketTypeId, capacities }),
            })
            const payload = (await response.json()) as ApiResponse<{ plan: MembershipSlotInventoryReport | null }>
            if (!response.ok || !payload.success || !payload.data?.plan) throw new Error(payload.error ?? "No se pudieron guardar los cupos")
            onSaved(payload.data.plan)
            setMessage({ kind: "ok", text: "Cupos guardados. Ya rigen para las nuevas compras." })
        } catch (saveError) {
            setMessage({ kind: "error", text: saveError instanceof Error ? saveError.message : "Error inesperado" })
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card>
            <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                    <Clock3 className="h-5 w-5" />
                    Cupos por horario · {plan.name}
                </CardTitle>
                <p className="text-sm text-slate-500">
                    Vendidos por franja y cupo editable. Los pendientes son compras en proceso de pago: retienen la
                    franja hasta que se pagan o vencen. Los totales están en alumnos y el cupo total del plan se ajusta a
                    ellos (un niño de Mar-Jue-Sáb ocupa una franja de Mar/Jue y otra de sábado).
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid overflow-hidden rounded-2xl bg-slate-950 text-white sm:grid-cols-4">
                    <Stat label="Cupo total" value={totals.capacity} />
                    <Stat label="Pagados" value={totals.paid} />
                    <Stat label="Pendientes de pago" value={totals.pending} tone="amber" />
                    <Stat label="Libres" value={totals.available} tone="emerald" />
                </div>

                {plan.invalidPaid + plan.invalidPending > 0 ? (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                        <AlertCircle className="h-4 w-4" />
                        Hay {plan.invalidPaid + plan.invalidPending} reserva(s) con un horario fuera del catálogo: mientras
                        existan, el sistema no puede validar cupos y las compras de este plan fallan.
                    </div>
                ) : null}

                <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[720px] text-left text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-4 py-3 font-semibold">Horario</th>
                                <th className="px-4 py-3 font-semibold">Categoría</th>
                                <th className="px-4 py-3 text-right font-semibold">Pagados</th>
                                <th className="px-4 py-3 text-right font-semibold">Pendientes</th>
                                <th className="px-4 py-3 text-right font-semibold">Cupo</th>
                                <th className="px-4 py-3 text-right font-semibold">Libres</th>
                            </tr>
                        </thead>
                        <tbody>
                            {categories.flatMap((categoryLabel) =>
                                plan.slots
                                    .filter((slot) => slot.categoryLabel === categoryLabel)
                                    // Por frecuencia (L-M-V, luego M-J-S), sábado al final, y por hora.
                                    .sort((a, b) =>
                                        a.frequency.localeCompare(b.frequency) ||
                                        Number(a.groupId === "saturday") - Number(b.groupId === "saturday") ||
                                        a.start.localeCompare(b.start)
                                    )
                                    .map((slot) => {
                                        const value = parsed(slot)
                                        const reserved = slot.paid + slot.pending
                                        const tooLow = value !== null && value < reserved
                                        const capacity = value ?? slot.capacity
                                        const free = Math.max(capacity - reserved, 0)
                                        const changed = value !== slot.capacity
                                        return (
                                            <tr key={slot.key} className={`border-t border-slate-100 ${changed ? "bg-sky-50/60" : ""}`}>
                                                <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-900">
                                                    {formatTime12h(slot.start)} – {formatTime12h(slot.end)}
                                                    {showGroup ? (
                                                        <span className="block text-xs font-normal text-slate-500">
                                                            {slot.frequencyLabel} · {slot.groupLabel}
                                                        </span>
                                                    ) : null}
                                                </td>
                                                <td className="px-4 py-2 text-slate-700">{slot.categoryLabel}</td>
                                                <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-950">{slot.paid}</td>
                                                <td className="px-4 py-2 text-right tabular-nums text-amber-700">{slot.pending || "—"}</td>
                                                <td className="px-4 py-2 text-right">
                                                    <Input
                                                        type="number"
                                                        min={reserved}
                                                        max={999}
                                                        step={1}
                                                        inputMode="numeric"
                                                        aria-label={`Cupo ${slot.start}-${slot.end} ${slot.categoryLabel}`}
                                                        value={draft[slot.key] ?? ""}
                                                        onChange={(event) =>
                                                            setDraft((current) => ({ ...current, [slot.key]: event.target.value }))
                                                        }
                                                        className={`ml-auto h-9 w-20 text-right tabular-nums ${value === null || tooLow ? "border-red-400" : ""}`}
                                                    />
                                                    {tooLow ? (
                                                        <span className="mt-1 block text-xs text-red-600">Mínimo {reserved}</span>
                                                    ) : slot.capacity !== slot.defaultCapacity ? (
                                                        <span className="mt-1 block text-xs text-slate-400">Original: {slot.defaultCapacity}</span>
                                                    ) : null}
                                                </td>
                                                <td className={`px-4 py-2 text-right font-semibold tabular-nums ${free === 0 ? "text-red-600" : "text-emerald-700"}`}>
                                                    {free === 0 ? "Agotado" : free}
                                                </td>
                                            </tr>
                                        )
                                    })
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <Button
                        type="button"
                        onClick={() => void save()}
                        disabled={saving || changedKeys.length === 0 || invalidSlots.length > 0}
                        className="gap-2"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {saving ? "Guardando…" : `Guardar cupos${changedKeys.length ? ` (${changedKeys.length})` : ""}`}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                            setDraft(initialDraft)
                            setMessage(null)
                            onReload()
                        }}
                        disabled={saving || reloading}
                        className="gap-2"
                    >
                        <RotateCcw className="h-4 w-4" />
                        Descartar y actualizar
                    </Button>
                    {message ? (
                        <span className={`flex items-center gap-1 text-sm ${message.kind === "ok" ? "text-emerald-700" : "text-red-700"}`}>
                            {message.kind === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                            {message.text}
                        </span>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "amber" | "emerald" }) {
    const color = tone === "amber" ? "text-amber-300" : tone === "emerald" ? "text-emerald-300" : ""
    return (
        <div className="border-t border-white/10 p-5 first:border-t-0 sm:border-r sm:border-t-0 sm:last:border-r-0">
            <p className="text-sm text-slate-300">{label}</p>
            <p className={`mt-1 text-3xl font-semibold tabular-nums ${color}`}>{value}</p>
        </div>
    )
}
