"use client"

import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, Snowflake } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
    const { applied, availableMonths } = detail.membershipFreeze
    const [month, setMonth] = useState(availableMonths[0]?.month ?? "")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    useEffect(() => {
        setMonth(availableMonths[0]?.month ?? "")
    }, [availableMonths])

    async function freezeMembership() {
        if (!month || busy) return

        const monthLabel = formatMonthLabel(month)
        if (
            !window.confirm(
                `Se congelará esta membresía durante ${monthLabel}. El QR no funcionará ese mes y la vigencia se extenderá un mes. Esta acción solo puede usarse una vez. ¿Continuar?`
            )
        ) {
            return
        }

        setBusy(true)
        setError(null)
        setSuccess(null)

        try {
            const response = await fetch(`/api/membership/${detail.ticket.id}/freeze`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ month }),
            })
            const payload = (await response.json().catch(() => null)) as
                | { success?: boolean; error?: string }
                | null

            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error ?? "No se pudo congelar la membresía")
            }

            setSuccess(`Membresía congelada para ${monthLabel}.`)
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
                    Suspende el acceso durante un mes calendario completo y extiende la vigencia por
                    un mes. Como administrador puedes hacerlo incluso durante el mes en curso, sin
                    anticipación mínima. Cada membresía puede congelarse una sola vez.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                {applied ? (
                    <div className="flex items-start gap-3 rounded-lg bg-sky-50 p-4 text-sm text-sky-900">
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
                        <div>
                            <p className="font-semibold">
                                Congelada en {formatMonthLabel(applied.month)}
                            </p>
                            <p className="mt-1 text-sky-800">
                                Sin acceso del {formatDateLabel(applied.start)} al{" "}
                                {formatDateLabel(previousDateKey(applied.end))}. La vigencia ya incluye
                                la extensión correspondiente.
                            </p>
                        </div>
                    </div>
                ) : availableMonths.length > 0 ? (
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
                ) : (
                    <div className="flex items-start gap-3 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
                        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                        <p>
                            No hay meses disponibles. La membresía debe estar activa y el mes completo
                            debe quedar dentro de su vigencia.
                        </p>
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
