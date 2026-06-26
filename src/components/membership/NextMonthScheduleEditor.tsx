"use client"

import { useState } from "react"
import { Calendar, Clock, Check } from "lucide-react"
import { MembershipScheduleSelector } from "./MembershipScheduleSelector"
import {
    formatScheduleSummary,
    scheduleSelectionToInput,
    type MembershipScheduleProfile,
    type MembershipScheduleInput,
    type MembershipScheduleSelection,
} from "@/lib/membership-schedule"

interface Props {
    ticketId: string
    profile: MembershipScheduleProfile
    /** Horario que regiría el próximo mes hoy (heredado o ya elegido), para precargar. */
    initial: MembershipScheduleInput
    /** Texto legible del horario previsto para el próximo mes. */
    summary: string
    /** Fecha (legible) en que empieza el próximo mes. */
    nextMonthLabel: string | null
}

/**
 * Permite al alumno fijar el horario de su PRÓXIMO mes de membresía. Si no cambia
 * nada, se mantiene el heredado. El mes en curso no se toca.
 */
export function NextMonthScheduleEditor({ ticketId, profile, initial, summary, nextMonthLabel }: Props) {
    const [editing, setEditing] = useState(false)
    const [committed, setCommitted] = useState<MembershipScheduleInput>(initial)
    const [value, setValue] = useState<MembershipScheduleInput>(initial)
    const [summaryText, setSummaryText] = useState(summary)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    const save = async () => {
        setSaving(true)
        setError(null)
        try {
            const res = await fetch(`/api/membership/${ticketId}/schedule`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ schedule: value }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                setError(data.error || "No se pudo guardar el horario.")
                return
            }
            const savedSelection = data.data?.selection as MembershipScheduleSelection | undefined
            if (savedSelection) {
                const savedInput = scheduleSelectionToInput(savedSelection)
                setSummaryText(formatScheduleSummary(savedSelection))
                setCommitted(savedInput)
                setValue(savedInput)
            }
            setSaved(true)
            setEditing(false)
        } catch {
            setError("No se pudo guardar el horario. Intenta de nuevo.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
            <div className="flex items-start gap-2">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                <div className="flex-1">
                    <p className="text-sm font-semibold text-sky-900">Horario del próximo mes</p>
                    {nextMonthLabel && (
                        <p className="text-[11px] text-sky-700">A partir del {nextMonthLabel}</p>
                    )}
                    <p className="mt-1 flex items-center gap-1 text-sm text-gray-700">
                        <Clock className="h-3.5 w-3.5 text-sky-500" />
                        {summaryText}
                    </p>
                    {saved && !editing && (
                        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-green-600">
                            <Check className="h-3.5 w-3.5" /> Horario del próximo mes actualizado.
                        </p>
                    )}
                </div>
            </div>

            {!editing ? (
                <button
                    type="button"
                    onClick={() => {
                        setValue(committed)
                        setEditing(true)
                        setSaved(false)
                    }}
                    className="mt-3 rounded-md border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                >
                    Cambiar horario del próximo mes
                </button>
            ) : (
                <div className="mt-3 space-y-3">
                    <MembershipScheduleSelector
                        profile={profile}
                        value={value}
                        onChange={setValue}
                        disabled={saving}
                    />
                    {error && <p className="text-xs font-medium text-red-600">{error}</p>}
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving}
                            className="rounded-md bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                        >
                            {saving ? "Guardando…" : "Guardar para el próximo mes"}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setEditing(false)
                                setValue(committed)
                                setError(null)
                            }}
                            disabled={saving}
                            className="rounded-md border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                        >
                            Cancelar
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
