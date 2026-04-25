"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Copy, X, AlertCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type DuplicateEventButtonProps = {
    eventId: string
    eventTitle: string
    eventStartDate: string
    eventEndDate: string
    eventCategory: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
}

const formatDateInput = (iso: string): string => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ""
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const addDaysToKey = (key: string, days: number): string => {
    const [y, m, d] = key.split("-").map(Number)
    const date = new Date(Date.UTC(y, m - 1, d, 12))
    date.setUTCDate(date.getUTCDate() + days)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const addMonthsToKey = (key: string, months: number): string => {
    const [y, m, d] = key.split("-").map(Number)
    const date = new Date(Date.UTC(y, m - 1, d, 12))
    date.setUTCMonth(date.getUTCMonth() + months)
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const lastDayOfMonth = (year: number, monthIndex: number): number =>
    new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()

const MONTH_LABELS_ES = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]

function suggestNextMonthRange(startKey: string): { start: string; end: string } {
    const [y, m] = startKey.split("-").map(Number)
    const nextDate = new Date(Date.UTC(y, m, 1, 12))
    const nextYear = nextDate.getUTCFullYear()
    const nextMonth = nextDate.getUTCMonth()
    const start = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01`
    const end = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(lastDayOfMonth(nextYear, nextMonth)).padStart(2, "0")}`
    return { start, end }
}

function suggestNextTitle(originalTitle: string, originalStart: string, newStart: string): string {
    const [oy, om] = originalStart.split("-").map(Number)
    const [ny, nm] = newStart.split("-").map(Number)
    const oldLabel = MONTH_LABELS_ES[om - 1]
    const newLabel = MONTH_LABELS_ES[nm - 1]
    const oldYear = String(oy)
    const newYear = String(ny)
    let next = originalTitle
    next = next.replaceAll(oldLabel, newLabel)
    next = next.replaceAll(oldLabel.toLowerCase(), newLabel.toLowerCase())
    next = next.replaceAll(toTitleCase(oldLabel), toTitleCase(newLabel))
    if (oldYear !== newYear) {
        next = next.replaceAll(oldYear, newYear)
    }
    return next === originalTitle ? `${originalTitle} (copia)` : next
}

function toTitleCase(value: string): string {
    if (!value) return value
    return value[0].toUpperCase() + value.slice(1).toLowerCase()
}

export function DuplicateEventButton({
    eventId,
    eventTitle,
    eventStartDate,
    eventEndDate,
    eventCategory,
}: DuplicateEventButtonProps) {
    const router = useRouter()
    const isPiscinaLibre = eventCategory === "PISCINA_LIBRE"

    const originalStartKey = useMemo(() => formatDateInput(eventStartDate), [eventStartDate])
    const originalEndKey = useMemo(() => formatDateInput(eventEndDate), [eventEndDate])

    const initialSuggestion = useMemo(() => {
        const range = suggestNextMonthRange(originalStartKey)
        return {
            title: suggestNextTitle(eventTitle, originalStartKey, range.start),
            startDate: range.start,
            endDate: range.end,
        }
    }, [originalStartKey, eventTitle])

    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState(initialSuggestion.title)
    const [startDate, setStartDate] = useState(initialSuggestion.startDate)
    const [endDate, setEndDate] = useState(initialSuggestion.endDate)
    const [remap, setRemap] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleOpen = () => {
        const range = suggestNextMonthRange(originalStartKey)
        setTitle(suggestNextTitle(eventTitle, originalStartKey, range.start))
        setStartDate(range.start)
        setEndDate(range.end)
        setRemap(true)
        setError(null)
        setOpen(true)
    }

    const handleStartChange = (value: string) => {
        setStartDate(value)
        if (value && originalStartKey && originalEndKey) {
            const offset = Math.round(
                (new Date(originalEndKey).getTime() - new Date(originalStartKey).getTime()) /
                    (1000 * 60 * 60 * 24)
            )
            const computedEnd = addDaysToKey(value, offset)
            setEndDate(computedEnd)
        }
        const next = addMonthsToKey(value, 0)
        setTitle(suggestNextTitle(eventTitle, originalStartKey, next))
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (submitting) return
        setError(null)

        if (!title.trim()) {
            setError("El nombre es requerido")
            return
        }
        if (!startDate || !endDate) {
            setError("Selecciona fechas válidas")
            return
        }
        if (new Date(startDate).getTime() > new Date(endDate).getTime()) {
            setError("La fecha de inicio no puede ser posterior a la de fin")
            return
        }

        setSubmitting(true)
        try {
            const res = await fetch(`/api/admin/events/${eventId}/duplicate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    startDate,
                    endDate,
                    isPublished: false,
                    remapByDayOfWeek: remap,
                }),
            })
            const payload = await res.json().catch(() => ({}))
            if (!res.ok || !payload.success) {
                throw new Error(payload.error || "Error al duplicar evento")
            }
            setOpen(false)
            router.push(`/admin/eventos/${payload.data.id}`)
            router.refresh()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error al duplicar evento")
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <>
            <Button variant="outline" onClick={handleOpen}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicar evento
            </Button>

            {open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
                        <div className="flex items-start justify-between border-b p-4">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Duplicar evento</h2>
                                <p className="text-sm text-gray-500">
                                    Se crearán todos los tipos de entrada con sold = 0 y sin órdenes
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                aria-label="Cerrar"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4 p-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-gray-700">
                                    Nuevo nombre
                                </label>
                                <Input
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Nombre del nuevo evento"
                                    maxLength={200}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-gray-700">
                                        Fecha de inicio
                                    </label>
                                    <Input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => handleStartChange(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-gray-700">
                                        Fecha de fin
                                    </label>
                                    <Input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                    />
                                </div>
                            </div>

                            {isPiscinaLibre && (
                                <label className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
                                    <input
                                        type="checkbox"
                                        checked={remap}
                                        onChange={(e) => setRemap(e.target.checked)}
                                        className="mt-0.5"
                                    />
                                    <span>
                                        Re-mapear fechas por día de la semana (recomendado para Piscina Libre).
                                        Por ejemplo, los tickets de Lunes usarán los lunes del mes nuevo,
                                        los de Sábado los sábados, etc.
                                    </span>
                                </label>
                            )}

                            <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
                                Códigos ABIO/Servilex (servicio, sucursal, piscina) se copian sin cambios.
                                El nuevo evento se crea como <strong>borrador</strong> — luego puedes publicarlo.
                            </div>

                            {error && (
                                <div className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="flex justify-end gap-2 border-t pt-3">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setOpen(false)}
                                    disabled={submitting}
                                >
                                    Cancelar
                                </Button>
                                <Button type="submit" disabled={submitting}>
                                    {submitting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Duplicando...
                                        </>
                                    ) : (
                                        <>
                                            <Copy className="mr-2 h-4 w-4" />
                                            Duplicar
                                        </>
                                    )}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </>
    )
}
