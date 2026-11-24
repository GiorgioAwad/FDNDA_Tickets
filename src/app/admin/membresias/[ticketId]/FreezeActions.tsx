"use client"

import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Snowflake } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { MembershipDetail } from "./types"

function formatMonthLabel(month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) return month

    return new Intl.DateTimeFormat("es-PE", {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
    }).format(new Date(`${month}-01T12:00:00Z`))
}

function formatDateLabel(value: string) {
    return new Intl.DateTimeFormat("es-PE", {
        timeZone: "UTC",
        day: "2-digit",
        month: "long",
        year: "numeric",
    }).format(new Date(`${value}T12:00:00Z`))
}

function previousDateKey(value: string) {
    const date = new Date(`${value}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() - 1)
    return date.toISOString().slice(0, 10)
}

export function FreezeActions({
    detail,
    onFrozen,
}: {
    detail: MembershipDetail
    onFrozen: () => void
}) {
    const { applied, availableMonths, scheduled } = detail.membershipFreeze
    const [month, setMonth] = useState(availableMonths[0]?.month ?? "")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [force, setForce] = useState(false)
    const [forceMonth, setForceMonth] = useState("")
    const [forceMonths, setForceMonths] = useState<string[]>([])
    const [reason, setReason] = useState("")

    useEffect(() => {
        setMonth(availableMonths[0]?.month ?? "")
    }, [availableMonths])

    async function freezeMembership() {
        if (busy || (force ? forceMonths.length === 0 || reason.trim().length < 5 : !month)) return

        const monthLabel = force ? forceMonths.map(formatMonthLabel).join(", ") : formatMonthLabel(month)
        if (
            !window.confirm(
                `Se congelará esta membresía durante ${monthLabel}. El QR no funcionará en los meses congelados y la vigencia se extenderá un mes por cada mes nuevo. ¿Continuar?`
            )
        ) {
            return
        }

        setBusy(true)
        setError(null)
        setSuccess(null)

        try {
            const response = await fetch(force
                ? `/api/admin/memberships/${detail.ticket.id}/freeze`
                : `/api/membership/${detail.ticket.id}/freeze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(force ? { months: forceMonths, reason: reason.trim() } : { month }),
            })
            const payload = (await response.json().catch(() => null)) as
                | { success?: boolean; error?: string }
                | null

            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error ?? "No se pudo congelar la membresía")
            }

            setSuccess(`Membresía congelada para ${monthLabel}.`)
            setForceMonths([])
            setReason("")
            onFrozen()
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo congelar la membresía")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card id="congelamiento" className="scroll-mt-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Snowflake className="h-5 w-5 text-sky-600" />
                    Congelar membresía
                </CardTitle>
                <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    Suspende el acceso por meses calendario y extiende la vigencia un mes por cada mes
                    congelado. Usa el congelamiento forzado para autorizar varios meses, diciembre o
                    una nueva excepción en una membresía que ya fue congelada.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {scheduled && (
                    <div className="rounded-lg bg-sky-50 p-4 text-sm text-sky-900">
                        Cierre programado del evento: {formatDateLabel(scheduled.start)} al{" "}
                        {formatDateLabel(previousDateKey(scheduled.end))}. La vigencia se extiende{" "}
                        {scheduled.extensionMonths} meses.
                    </div>
                )}
                {applied ? (
                    <div className="flex items-start gap-3 rounded-lg bg-sky-50 p-4 text-sm text-sky-900">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
                        <div>
                            <p className="font-semibold">Congelamientos aplicados</p>
                            {(applied.ranges ?? [applied]).map((range) => (
                                <p key={range.start} className="mt-1 text-sky-800">
                                    {formatMonthLabel(range.month)}: sin acceso del {formatDateLabel(range.start)} al{" "}
                                    {formatDateLabel(previousDateKey(range.end))}.
                                </p>
                            ))}
                            <p className="mt-1 text-sky-800">La vigencia ya incluye la extensión correspondiente.</p>
                        </div>
                    </div>
                ) : !force && availableMonths.length > 0 ? (
                    <div className="flex max-w-2xl flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1">
                            <label
                                htmlFor="admin-freeze-month"
                                className="mb-1.5 block text-sm font-medium text-slate-700"
                            >
                                Mes a congelar
                            </label>
                            <select
                                id="admin-freeze-month"
                                value={month}
                                onChange={(event) => setMonth(event.target.value)}
                                disabled={busy}
                                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {availableMonths.map((option) => (
                                    <option key={option.month} value={option.month}>
                                        {formatMonthLabel(option.month)}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <Button
                            type="button"
                            onClick={() => void freezeMembership()}
                            disabled={!month || busy}
                            className="sm:min-w-48"
                        >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake />}
                            {busy ? "Congelando…" : "Congelar membresía"}
                        </Button>
                    </div>
                ) : !force ? (
                    <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                        <p>
                            No hay meses disponibles. La membresía debe estar activa y el mes completo
                            debe quedar dentro de su vigencia.
                        </p>
                    </div>
                ) : null}

                <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
                    <input type="checkbox" checked={force} disabled={busy}
                        onChange={(event) => { setForce(event.target.checked); setError(null); setSuccess(null) }}
                        className="h-4 w-4 rounded border-slate-300 accent-sky-700" />
                    Forzar congelamiento de uno o más meses
                </label>
                {force && (
                    <div className="max-w-2xl space-y-4">
                        <p className="text-sm text-slate-600">
                            Agrega los meses que autorizas; pueden ser consecutivos o separados.
                            Se conservan los congelamientos existentes. Los meses ya congelados no se duplican.
                            Enero y febrero ya se extienden automáticamente.
                        </p>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                            <div className="flex-1 space-y-1.5">
                                <label htmlFor="admin-force-month" className="block text-sm font-medium">Mes a agregar</label>
                                <Input id="admin-force-month" type="month" value={forceMonth} disabled={busy}
                                    onChange={(event) => setForceMonth(event.target.value)} />
                            </div>
                            <Button type="button" variant="outline" disabled={busy || !forceMonth || forceMonths.length >= 24 || forceMonths.includes(forceMonth)}
                                onClick={() => { setForceMonths([...forceMonths, forceMonth].sort()); setForceMonth("") }}>
                                Agregar mes
                            </Button>
                        </div>
                        {forceMonths.length > 0 && (
                            <ul className="space-y-2">
                                {forceMonths.map((value) => (
                                    <li key={value} className="flex items-center justify-between gap-3 text-sm">
                                        {formatMonthLabel(value)}
                                        <Button type="button" variant="ghost" size="sm" disabled={busy}
                                            aria-label={`Quitar ${formatMonthLabel(value)}`}
                                            onClick={() => setForceMonths(forceMonths.filter((item) => item !== value))}>Quitar</Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <div className="space-y-1.5">
                            <label htmlFor="admin-freeze-reason" className="block text-sm font-medium">Motivo de la autorización</label>
                            <Input id="admin-freeze-reason" value={reason} maxLength={1000} disabled={busy}
                                placeholder="Por ejemplo: solicitud del titular aprobada por administración"
                                onChange={(event) => setReason(event.target.value)} />
                        </div>
                        <Button type="button" onClick={() => void freezeMembership()}
                            disabled={busy || forceMonths.length === 0 || reason.trim().length < 5 || detail.ticket.status !== "ACTIVE"}>
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Snowflake className="h-4 w-4" />}
                            {busy ? "Congelando…" : `Forzar congelamiento (${forceMonths.length} ${forceMonths.length === 1 ? "mes" : "meses"})`}
                        </Button>
                    </div>
                )}

                {success ? (
                    <p role="status" className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        {success}
                    </p>
                ) : null}
                {error ? (
                    <p role="alert" className="flex items-center gap-2 text-sm font-medium text-red-700">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </p>
                ) : null}
            </CardContent>
        </Card>
    )
}
