"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, CalendarRange, Copy, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    getFirstFrequencyDate,
    isValidDateKey,
    type DuplicateScheduleFrequency,
} from "@/lib/event-duplication-schedule"

type DuplicateEventButtonProps = {
    eventId: string
    eventTitle: string
    eventStartDate: string
    eventEndDate: string
    eventCategory: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
    scheduleFrequencies: DuplicateScheduleFrequency[]
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
    const [year, month, day] = key.split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, 12))
    date.setUTCDate(date.getUTCDate() + days)
    const nextYear = date.getUTCFullYear()
    const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0")
    const nextDay = String(date.getUTCDate()).padStart(2, "0")
    return `${nextYear}-${nextMonth}-${nextDay}`
}

const addMonthsToKey = (key: string, months: number): string => {
    const [year, month, day] = key.split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, day, 12))
    date.setUTCMonth(date.getUTCMonth() + months)
    const nextYear = date.getUTCFullYear()
    const nextMonth = String(date.getUTCMonth() + 1).padStart(2, "0")
    const nextDay = String(date.getUTCDate()).padStart(2, "0")
    return `${nextYear}-${nextMonth}-${nextDay}`
}

const lastDayOfMonth = (year: number, monthIndex: number): number =>
    new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()

const MONTH_LABELS_ES = [
    "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
    "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
]

function suggestNextMonthRange(startKey: string): { start: string; end: string } {
    const [year, month] = startKey.split("-").map(Number)
    const nextDate = new Date(Date.UTC(year, month, 1, 12))
    const nextYear = nextDate.getUTCFullYear()
    const nextMonth = nextDate.getUTCMonth()
    const start = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01`
    const end = `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-${String(lastDayOfMonth(nextYear, nextMonth)).padStart(2, "0")}`
    return { start, end }
}

function suggestNextTitle(originalTitle: string, originalStart: string, newStart: string): string {
    const [originalYear, originalMonth] = originalStart.split("-").map(Number)
    const [newYear, newMonth] = newStart.split("-").map(Number)
    const oldLabel = MONTH_LABELS_ES[originalMonth - 1]
    const newLabel = MONTH_LABELS_ES[newMonth - 1]
    let next = originalTitle
    next = next.replaceAll(oldLabel, newLabel)
    next = next.replaceAll(oldLabel.toLowerCase(), newLabel.toLowerCase())
    next = next.replaceAll(toTitleCase(oldLabel), toTitleCase(newLabel))
    if (originalYear !== newYear) {
        next = next.replaceAll(String(originalYear), String(newYear))
    }
    return next === originalTitle ? `${originalTitle} (copia)` : next
}

function toTitleCase(value: string): string {
    if (!value) return value
    return value[0].toUpperCase() + value.slice(1).toLowerCase()
}

function buildFrequencyStartDates(
    frequencies: DuplicateScheduleFrequency[],
    startDate: string,
    endDate: string,
): Record<string, string> {
    return Object.fromEntries(
        frequencies.map((frequency) => [
            frequency.key,
            getFirstFrequencyDate(frequency.weekdays, startDate, endDate) ?? "",
        ])
    )
}

function formatCivilDate(dateKey: string | null): string | null {
    if (!dateKey) return null
    const [year, month, day] = dateKey.split("-").map(Number)
    return new Intl.DateTimeFormat("es-PE", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

export function DuplicateEventButton({
    eventId,
    eventTitle,
    eventStartDate,
    eventEndDate,
    eventCategory,
    scheduleFrequencies,
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
    const [frequencyStartDates, setFrequencyStartDates] = useState<Record<string, string>>(() =>
        buildFrequencyStartDates(scheduleFrequencies, initialSuggestion.startDate, initialSuggestion.endDate)
    )
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const remapsSchedules = !isPiscinaLibre || remap
    const showsFrequencyStarts = remapsSchedules && scheduleFrequencies.length > 0

    const handleOpen = () => {
        const range = suggestNextMonthRange(originalStartKey)
        setTitle(suggestNextTitle(eventTitle, originalStartKey, range.start))
        setStartDate(range.start)
        setEndDate(range.end)
        setRemap(true)
        setFrequencyStartDates(buildFrequencyStartDates(scheduleFrequencies, range.start, range.end))
        setError(null)
        setOpen(true)
    }

    const handleStartChange = (value: string) => {
        setStartDate(value)
        if (!isValidDateKey(value) || !originalStartKey || !originalEndKey) return

        const offset = Math.round(
            (new Date(originalEndKey).getTime() - new Date(originalStartKey).getTime()) /
                (1000 * 60 * 60 * 24)
        )
        const computedEnd = addDaysToKey(value, offset)
        setEndDate(computedEnd)
        setFrequencyStartDates(buildFrequencyStartDates(scheduleFrequencies, value, computedEnd))
        setTitle(suggestNextTitle(eventTitle, originalStartKey, addMonthsToKey(value, 0)))
    }

    const handleEndChange = (value: string) => {
        setEndDate(value)
        if (!isValidDateKey(startDate) || !isValidDateKey(value) || startDate > value) return

        setFrequencyStartDates((current) => {
            const defaults = buildFrequencyStartDates(scheduleFrequencies, startDate, value)
            return Object.fromEntries(scheduleFrequencies.map((frequency) => {
                const configured = current[frequency.key]
                const remainsValid =
                    isValidDateKey(configured) &&
                    configured >= startDate &&
                    configured <= value &&
                    getFirstFrequencyDate(frequency.weekdays, configured, value) !== null
                return [frequency.key, remainsValid ? configured : defaults[frequency.key]]
            }))
        })
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        if (submitting) return
        setError(null)

        if (!title.trim()) {
            setError("El nombre es requerido")
            return
        }
        if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
            setError("Selecciona fechas válidas para el nuevo evento")
            return
        }
        if (startDate > endDate) {
            setError("La fecha de inicio no puede ser posterior a la de fin")
            return
        }

        if (showsFrequencyStarts) {
            for (const frequency of scheduleFrequencies) {
                const configured = frequencyStartDates[frequency.key]
                if (!isValidDateKey(configured) || configured < startDate || configured > endDate) {
                    setError(`Selecciona un inicio válido para ${frequency.label}`)
                    return
                }
                if (!getFirstFrequencyDate(frequency.weekdays, configured, endDate)) {
                    setError(`No quedan fechas de ${frequency.label} desde el inicio seleccionado`)
                    return
                }
            }
        }

        setSubmitting(true)
        try {
            const response = await fetch(`/api/admin/events/${eventId}/duplicate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title: title.trim(),
                    startDate,
                    endDate,
                    isPublished: false,
                    remapByDayOfWeek: remap,
                    frequencyStartDates: showsFrequencyStarts ? frequencyStartDates : undefined,
                }),
            })
            const payload = await response.json().catch(() => ({}))
            if (!response.ok || !payload.success) {
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
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="duplicate-event-title"
                >
                    <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg bg-white shadow-xl">
                        <div className="sticky top-0 z-10 flex items-start justify-between border-b bg-white p-4">
                            <div className="min-w-0">
                                <h2 id="duplicate-event-title" className="text-lg font-semibold text-gray-900">
                                    Duplicar evento
                                </h2>
                                <p className="text-sm text-gray-500">
                                    Se crearán los tipos de entrada con ventas en cero y sin órdenes.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
                                aria-label="Cerrar"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-5 p-4">
                            <div>
                                <label htmlFor="duplicate-event-name" className="mb-1 block text-sm font-medium text-gray-700">
                                    Nuevo nombre
                                </label>
                                <Input
                                    id="duplicate-event-name"
                                    value={title}
                                    onChange={(event) => setTitle(event.target.value)}
                                    placeholder="Nombre del nuevo evento"
                                    maxLength={200}
                                    className="text-base sm:text-sm"
                                />
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="duplicate-event-start" className="mb-1 block text-sm font-medium text-gray-700">
                                        Fecha de inicio
                                    </label>
                                    <Input
                                        id="duplicate-event-start"
                                        type="date"
                                        value={startDate}
                                        onChange={(event) => handleStartChange(event.target.value)}
                                        className="text-base sm:text-sm"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="duplicate-event-end" className="mb-1 block text-sm font-medium text-gray-700">
                                        Fecha de fin
                                    </label>
                                    <Input
                                        id="duplicate-event-end"
                                        type="date"
                                        value={endDate}
                                        min={startDate}
                                        onChange={(event) => handleEndChange(event.target.value)}
                                        className="text-base sm:text-sm"
                                    />
                                </div>
                            </div>

                            {isPiscinaLibre && (
                                <label className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-sm text-blue-900">
                                    <input
                                        type="checkbox"
                                        checked={remap}
                                        onChange={(event) => setRemap(event.target.checked)}
                                        className="mt-0.5 h-4 w-4"
                                    />
                                    <span>
                                        Re-mapear fechas por día de la semana. Los tickets conservarán su frecuencia
                                        en el nuevo rango.
                                    </span>
                                </label>
                            )}

                            {showsFrequencyStarts && (
                                <section
                                    className="space-y-3 rounded-lg border border-sky-200 bg-sky-50/60 p-4"
                                    aria-labelledby="frequency-starts-title"
                                >
                                    <div className="flex items-start gap-3">
                                        <CalendarRange className="mt-0.5 h-5 w-5 flex-none text-sky-700" />
                                        <div>
                                            <h3 id="frequency-starts-title" className="font-semibold text-sky-950">
                                                Inicio por frecuencia
                                            </h3>
                                            <p className="mt-1 text-sm text-sky-900">
                                                Cada grupo generará clases desde la fecha indicada. La primera fecha real
                                                se ajusta al siguiente día que corresponda a su frecuencia.
                                            </p>
                                        </div>
                                    </div>

                                    <div className="divide-y divide-sky-200">
                                        {scheduleFrequencies.map((frequency) => {
                                            const configuredStart = frequencyStartDates[frequency.key] ?? ""
                                            const firstDate = isValidDateKey(configuredStart) && isValidDateKey(endDate)
                                                ? getFirstFrequencyDate(frequency.weekdays, configuredStart, endDate)
                                                : null
                                            return (
                                                <div
                                                    key={frequency.key}
                                                    className="grid gap-2 py-3 first:pt-1 last:pb-0 sm:grid-cols-[minmax(0,1fr)_13rem] sm:items-center sm:gap-4"
                                                >
                                                    <div className="min-w-0">
                                                        <label
                                                            htmlFor={`frequency-start-${frequency.key}`}
                                                            className="block font-medium text-sky-950"
                                                        >
                                                            {frequency.label}
                                                        </label>
                                                        <p className="text-sm text-sky-800">
                                                            {frequency.ticketTypeCount === 1
                                                                ? "1 tipo de entrada"
                                                                : `${frequency.ticketTypeCount} tipos de entrada`}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <Input
                                                            id={`frequency-start-${frequency.key}`}
                                                            type="date"
                                                            value={configuredStart}
                                                            min={startDate}
                                                            max={endDate}
                                                            required
                                                            onChange={(event) => setFrequencyStartDates((current) => ({
                                                                ...current,
                                                                [frequency.key]: event.target.value,
                                                            }))}
                                                            className="bg-white text-base tabular-nums sm:text-sm"
                                                            aria-describedby={`frequency-first-${frequency.key}`}
                                                        />
                                                        <p
                                                            id={`frequency-first-${frequency.key}`}
                                                            className="mt-1 text-xs text-sky-800"
                                                        >
                                                            {firstDate
                                                                ? `Primera clase: ${formatCivilDate(firstDate)}`
                                                                : "No hay una clase disponible en este rango"}
                                                        </p>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </section>
                            )}

                            <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
                                Los códigos ABIO/Servilex se copian sin cambios. El nuevo evento se crea como
                                <strong> borrador</strong> para que puedas revisarlo antes de publicarlo.
                            </div>

                            {error && (
                                <div
                                    className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-sm text-red-700"
                                    role="alert"
                                    aria-live="polite"
                                >
                                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
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
