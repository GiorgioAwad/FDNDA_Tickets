"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertCircle, CalendarDays, CheckCircle2, Loader2 } from "lucide-react"

import type { MembershipDetail } from "@/app/admin/membresias/[ticketId]/types"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type DatePlan = {
    label: string
    before: { scheduleSummary: string }
    after: { scheduleSummary: string; capacityOverride?: boolean }
    fingerprint: string
    overCapacityOverride: boolean
}

function dateLabel(value: string) {
    return new Intl.DateTimeFormat("es-PE", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`))
}

export function DateChangeActions({
    detail,
    onApplied,
}: {
    detail: MembershipDetail
    onApplied: () => void
}) {
    const availableSelections = useMemo(
        () => detail.dateChange.currentSelections.filter((item) => item.status === "AVAILABLE"),
        [detail.dateChange.currentSelections]
    )
    const [sourceDate, setSourceDate] = useState(availableSelections[0]?.date ?? "")
    const [targetDate, setTargetDate] = useState("")
    const [targetShift, setTargetShift] = useState("")
    const [reason, setReason] = useState("")
    const [allowOverCapacity, setAllowOverCapacity] = useState(false)
    const [plan, setPlan] = useState<DatePlan | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const selectedOption =
        detail.dateChange.options.find((option) => option.date === targetDate) ?? null
    const isFull = Boolean(
        selectedOption &&
            selectedOption.capacity > 0 &&
            selectedOption.sold >= selectedOption.capacity
    )

    useEffect(() => {
        setSourceDate(availableSelections[0]?.date ?? "")
        setTargetDate("")
        setTargetShift("")
        setReason("")
        setAllowOverCapacity(false)
        setPlan(null)
        setError(null)
    }, [detail.ticket.id, detail.ticketType.id, availableSelections])

    useEffect(() => {
        setTargetShift(selectedOption?.shifts[0] ?? "")
        setAllowOverCapacity(false)
        setPlan(null)
        setError(null)
    }, [selectedOption])

    if (!detail.dateChange.enabled) {
        return detail.dateChange.reason ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 ring-1 ring-slate-200">
                {detail.dateChange.reason}
            </p>
        ) : null
    }

    const send = async (preview: boolean) => {
        setBusy(true)
        setError(null)
        try {
            const response = await fetch(
                `/api/admin/memberships/${detail.ticket.id}/date`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        sourceDate,
                        targetDate,
                        targetShift: targetShift || null,
                        allowOverCapacity,
                        reason,
                        preview,
                        fingerprint: preview ? undefined : plan?.fingerprint,
                    }),
                }
            )
            const payload = (await response.json()) as {
                success: boolean
                error?: string
                data?: { plan: DatePlan }
            }
            if (!response.ok || !payload.success || !payload.data) {
                throw new Error(payload.error ?? "No se pudo cambiar la fecha")
            }
            if (preview) {
                setPlan(payload.data.plan)
            } else {
                setPlan(null)
                onApplied()
            }
        } catch (sendError) {
            setPlan(null)
            setError(sendError instanceof Error ? sendError.message : "Error inesperado")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-5 w-5" />
                    Cambiar fecha o turno
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
                <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Fecha comprada
                        </span>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-300 p-2"
                            value={sourceDate}
                            disabled={busy}
                            onChange={(event) => {
                                setSourceDate(event.target.value)
                                setPlan(null)
                            }}
                        >
                            {availableSelections.map((selection) => (
                                <option key={selection.date} value={selection.date}>
                                    {dateLabel(selection.date)}
                                    {selection.shift ? ` · ${selection.shift}` : ""}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Nueva fecha
                        </span>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-300 p-2"
                            value={targetDate}
                            disabled={busy}
                            onChange={(event) => setTargetDate(event.target.value)}
                        >
                            <option value="">Selecciona una fecha</option>
                            {detail.dateChange.options.map((option) => (
                                <option
                                    key={option.date}
                                    value={option.date}
                                    disabled={!option.isEnabled}
                                >
                                    {dateLabel(option.date)} · {option.sold}/
                                    {option.capacity === 0 ? "∞" : option.capacity}
                                    {!option.isEnabled ? " · cerrada" : ""}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>

                {selectedOption && selectedOption.shifts.length > 0 ? (
                    <label className="block">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            Turno
                        </span>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-300 p-2"
                            value={targetShift}
                            disabled={busy}
                            onChange={(event) => {
                                setTargetShift(event.target.value)
                                setPlan(null)
                            }}
                        >
                            {selectedOption.shifts.map((shift) => (
                                <option key={shift} value={shift}>{shift}</option>
                            ))}
                        </select>
                    </label>
                ) : null}

                {isFull ? (
                    <label className="flex cursor-pointer gap-3 rounded-xl bg-amber-50 p-4 text-amber-950 ring-1 ring-amber-200">
                        <input
                            type="checkbox"
                            checked={allowOverCapacity}
                            disabled={busy}
                            onChange={(event) => {
                                setAllowOverCapacity(event.target.checked)
                                setPlan(null)
                            }}
                        />
                        <span>
                            <strong className="block">Forzar sobrecupo</strong>
                            La fecha está llena. Esta excepción quedará registrada.
                        </span>
                    </label>
                ) : null}

                <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Motivo
                    </span>
                    <Input
                        className="mt-1"
                        value={reason}
                        disabled={busy}
                        placeholder="Ej. solicitud del asistente"
                        onChange={(event) => {
                            setReason(event.target.value)
                            setPlan(null)
                        }}
                    />
                </label>

                {error ? (
                    <div role="alert" className="flex gap-2 rounded-xl bg-red-50 p-3 text-red-800 ring-1 ring-red-200">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{error}</span>
                    </div>
                ) : null}

                {plan ? (
                    <div className="rounded-xl bg-emerald-50 p-4 text-emerald-950 ring-1 ring-emerald-200">
                        <div className="flex gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                            <div>
                                <strong className="block">Vista previa lista</strong>
                                <span>{plan.before.scheduleSummary} → {plan.after.scheduleSummary}</span>
                            </div>
                        </div>
                    </div>
                ) : null}

                <div className="flex flex-wrap justify-end gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !sourceDate || !targetDate || (isFull && !allowOverCapacity)}
                        onClick={() => void send(true)}
                    >
                        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Previsualizar
                    </Button>
                    <Button
                        type="button"
                        disabled={
                            busy ||
                            !plan ||
                            reason.trim().length < (allowOverCapacity ? 10 : 5)
                        }
                        onClick={() => void send(false)}
                    >
                        Aplicar cambio
                    </Button>
                </div>
            </CardContent>
        </Card>
    )
}
