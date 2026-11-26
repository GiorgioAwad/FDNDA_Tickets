"use client"

import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Loader2, UserPen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { buildNaturalPersonFullName, splitNaturalPersonName } from "@/lib/billing"
import type { MembershipDetail } from "./types"

type NameFields = { firstName: string; secondName: string; lastNamePaternal: string; lastNameMaternal: string }

const FIELDS: Array<{ key: keyof NameFields; label: string; required: boolean }> = [
    { key: "firstName", label: "Primer nombre", required: true },
    { key: "secondName", label: "Segundo nombre", required: false },
    { key: "lastNamePaternal", label: "Apellido paterno", required: true },
    { key: "lastNameMaternal", label: "Apellido materno", required: false },
]

/**
 * Corrige el nombre del asistente del carnet (lo que ven el escáner, la asistencia
 * y los reportes). DNI, matrícula, horario y comprobante emitido no cambian.
 */
export function AttendeeActions({ detail, onRenamed }: { detail: MembershipDetail; onRenamed: () => void }) {
    const currentName = detail.ticket.attendeeName
    const [fields, setFields] = useState<NameFields>(() => splitNaturalPersonName(currentName ?? ""))
    const [reason, setReason] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)

    useEffect(() => {
        setFields(splitNaturalPersonName(currentName ?? ""))
    }, [currentName])

    const newName = buildNaturalPersonFullName(fields)
    const canSubmit =
        !busy &&
        detail.ticket.status === "ACTIVE" &&
        fields.firstName.trim().length >= 2 &&
        fields.lastNamePaternal.trim().length >= 2 &&
        reason.trim().length >= 5 &&
        newName !== (currentName ?? "")

    async function rename() {
        if (!canSubmit) return
        if (!window.confirm(`Se cambiará el nombre del asistente:\n\n${currentName ?? "(sin nombre)"}\n→ ${newName}\n\nEl DNI, la matrícula y el horario no cambian. ¿Continuar?`)) {
            return
        }
        setBusy(true)
        setError(null)
        setSuccess(null)
        try {
            const response = await fetch(`/api/admin/memberships/${detail.ticket.id}/attendee`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...fields, expectedCurrentName: currentName, reason: reason.trim() }),
            })
            const payload = (await response.json().catch(() => null)) as
                | { success?: boolean; error?: string; data?: { afterName: string } }
                | null
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error ?? "No se pudo cambiar el nombre")
            }
            setSuccess(`Nombre actualizado a ${payload.data?.afterName ?? newName}.`)
            setReason("")
            onRenamed()
        } catch (err) {
            setError(err instanceof Error ? err.message : "No se pudo cambiar el nombre")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Card id="nombre" className="scroll-mt-6">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <UserPen className="h-5 w-5 text-slate-700" />
                    Cambiar nombre del asistente
                </CardTitle>
                <p className="max-w-3xl text-sm leading-6 text-slate-600">
                    Corrige el nombre que aparece en el carnet, el escáner y los reportes. El DNI, la matrícula,
                    el horario y la boleta emitida se conservan.
                </p>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
                    {FIELDS.map((field) => (
                        <div key={field.key} className="space-y-1.5">
                            <label htmlFor={`attendee-${field.key}`} className="block text-sm font-medium text-slate-700">
                                {field.label}
                                {field.required ? "" : " (opcional)"}
                            </label>
                            <Input
                                id={`attendee-${field.key}`}
                                value={fields[field.key]}
                                maxLength={60}
                                disabled={busy}
                                onChange={(event) => {
                                    setFields({ ...fields, [field.key]: event.target.value })
                                    setError(null)
                                    setSuccess(null)
                                }}
                            />
                        </div>
                    ))}
                </div>
                <p className="text-sm text-slate-600">
                    Nombre resultante: <span className="font-medium text-slate-900">{newName || "—"}</span>
                </p>
                <div className="max-w-3xl space-y-1.5">
                    <label htmlFor="attendee-reason" className="block text-sm font-medium text-slate-700">
                        Motivo (queda en el historial)
                    </label>
                    <Input
                        id="attendee-reason"
                        value={reason}
                        maxLength={1000}
                        disabled={busy}
                        placeholder="Ej. El apoderado registró su nombre en lugar del alumno"
                        onChange={(event) => setReason(event.target.value)}
                    />
                    <p className="text-xs text-slate-500">Mínimo 5 caracteres.</p>
                </div>
                <Button type="button" onClick={() => void rename()} disabled={!canSubmit}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPen className="h-4 w-4" />}
                    {busy ? "Guardando…" : "Cambiar nombre"}
                </Button>
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
