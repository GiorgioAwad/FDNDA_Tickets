"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Edit, Save, Power } from "lucide-react"
import { formatDate, formatPrice } from "@/lib/utils"
import { buildTicketValidDaysPayload, parseTicketScheduleConfig } from "@/lib/ticket-schedule"

interface TicketType {
    id?: string
    name: string
    description?: string | null
    price: number
    capacity: number
    sold?: number
    isActive?: boolean
    isPackage?: boolean
    packageDaysCount?: number
    validDays?: unknown
    sortOrder?: number
}

interface TicketTypeManagerProps {
    eventId: string
    initialTicketTypes: TicketType[]
    eventStartDate?: string | Date
    eventEndDate?: string | Date
}

export function TicketTypeManager({
    eventId,
    initialTicketTypes,
    eventStartDate,
    eventEndDate,
}: TicketTypeManagerProps) {
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>(initialTicketTypes)
    const [isAdding, setIsAdding] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [entryMode, setEntryMode] = useState<"standard" | "shift">("standard")
    const [loading, setLoading] = useState(false)

    const [autoName, setAutoName] = useState(true)
    const [daysLabel, setDaysLabel] = useState("L-M-V")
    const [sessionsPerWeek, setSessionsPerWeek] = useState(3)
    const [startTime, setStartTime] = useState("09:00")
    const [endTime, setEndTime] = useState("10:00")
    const [customLabel, setCustomLabel] = useState("")
    const [useSpecificDays, setUseSpecificDays] = useState(false)
    const [selectedValidDays, setSelectedValidDays] = useState<string[]>([])
    const [shiftsInput, setShiftsInput] = useState("")
    const [requireShiftSelection, setRequireShiftSelection] = useState(true)
    const [fullDayPackageDays, setFullDayPackageDays] = useState(4)

    const [formData, setFormData] = useState<Partial<TicketType>>({
        name: "",
        description: "",
        price: 0,
        capacity: 100,
        isPackage: false,
        packageDaysCount: 0,
        sortOrder: 0,
    })
    const [capacityInput, setCapacityInput] = useState("100")

    const isShiftTicketType = (ticket: TicketType) => {
        const schedule = parseTicketScheduleConfig(ticket.validDays)
        return schedule.dates.length > 0 || schedule.shifts.length > 0
    }

    const standardTicketTypes = useMemo(
        () => ticketTypes.filter((ticket) => !isShiftTicketType(ticket)),
        [ticketTypes]
    )
    const shiftTicketTypes = useMemo(
        () => ticketTypes.filter((ticket) => isShiftTicketType(ticket)),
        [ticketTypes]
    )

    const quickPresets = useMemo(
        () => [
            { label: "M-J", sessions: 2 },
            { label: "M-J-S", sessions: 3 },
            { label: "L-M-V", sessions: 3 },
            { label: "L-M-J", sessions: 3 },
            { label: "L-M-J-V", sessions: 4 },
            { label: "L-S", sessions: 6 },
            { label: "S-D", sessions: 2 },
            { label: "D", sessions: 1 },
        ],
        []
    )

    const dateOptions = useMemo(() => {
        if (!eventStartDate || !eventEndDate) return []
        const start = new Date(eventStartDate)
        const end = new Date(eventEndDate)
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []

        start.setHours(0, 0, 0, 0)
        end.setHours(0, 0, 0, 0)
        const options: string[] = []
        const current = new Date(start)
        while (current <= end) {
            const year = current.getFullYear()
            const month = String(current.getMonth() + 1).padStart(2, "0")
            const day = String(current.getDate()).padStart(2, "0")
            options.push(`${year}-${month}-${day}`)
            current.setDate(current.getDate() + 1)
        }
        return options
    }, [eventStartDate, eventEndDate])

    const formatTimeLabel = (timeValue: string) => {
        if (!timeValue) return ""
        const parts = timeValue.split(":")
        if (parts.length !== 2) return timeValue
        const hh = Number(parts[0])
        const mm = Number(parts[1])
        if (Number.isNaN(hh) || Number.isNaN(mm)) return timeValue
        const period = hh >= 12 ? "PM" : "AM"
        const hour = ((hh + 11) % 12) + 1
        const minutes = mm === 0 ? "" : `:${String(mm).padStart(2, "0")}`
        return `${hour}${minutes}${period}`
    }

    const getWeekdayIndexes = (label: string) => {
        const map: Record<string, number> = {
            L: 1, // Monday
            M: 2, // Tuesday
            X: 3, // Wednesday
            J: 4, // Thursday
            V: 5, // Friday
            S: 6, // Saturday
            D: 0, // Sunday
        }
        return label.split("-").map((part) => map[part]).filter((val) => val !== undefined)
    }

    const countClassesBetween = (start?: string | Date, end?: string | Date, label?: string) => {
        if (!start || !end || !label) return null
        const startDate = new Date(start)
        const endDate = new Date(end)
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null
        startDate.setHours(0, 0, 0, 0)
        endDate.setHours(0, 0, 0, 0)
        if (startDate > endDate) return null

        const days = getWeekdayIndexes(label)
        if (days.length === 0) return null

        let count = 0
        const current = new Date(startDate)
        while (current <= endDate) {
            if (days.includes(current.getDay())) {
                count += 1
            }
            current.setDate(current.getDate() + 1)
        }
        return count
    }

    const buildName = () => {
        const base = customLabel.trim() || daysLabel
        const classesTotal = countClassesBetween(eventStartDate, eventEndDate, daysLabel)
        const classesText = classesTotal ? `${classesTotal} clases` : ""
        const sessionsText = sessionsPerWeek ? `${sessionsPerWeek} sesiones/semana` : ""
        const timeText = startTime && endTime
            ? `${formatTimeLabel(startTime)}-${formatTimeLabel(endTime)}`
            : ""
        const parts = [classesText, sessionsText, timeText].filter(Boolean)
        if (!parts.length) return base
        return `Turno ${base} · ${parts.join(" · ")}`
    }

    useEffect(() => {
        if (entryMode !== "shift" || !autoName) return
        const generatedName = buildName()
        setFormData((prev) => ({ ...prev, name: generatedName }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entryMode, autoName, daysLabel, sessionsPerWeek, startTime, endTime, customLabel, eventStartDate, eventEndDate])

    const resetForm = () => {
        setFormData({
            name: "",
            description: "",
            price: 0,
            capacity: 100,
            isPackage: false,
            packageDaysCount: 0,
            sortOrder: 0,
        })
        setCapacityInput("100")
        setAutoName(true)
        setDaysLabel("L-M-V")
        setSessionsPerWeek(3)
        setStartTime("09:00")
        setEndTime("10:00")
        setCustomLabel("")
        setUseSpecificDays(false)
        setSelectedValidDays([])
        setShiftsInput("")
        setRequireShiftSelection(true)
        setFullDayPackageDays(4)
        setEntryMode("standard")
        setIsAdding(false)
        setEditingId(null)
    }

    const handleSave = async () => {
        if (!formData.name || formData.price === undefined) return

        const capacityValue = capacityInput.trim()
        const capacityNumber = capacityValue === "" ? 0 : Number(capacityValue)
        if (Number.isNaN(capacityNumber) || capacityNumber < 0) {
            alert("Capacidad invalida")
            return
        }

        const shifts = shiftsInput
            .split(",")
            .map((shift) => shift.trim())
            .filter(Boolean)
        const selectedDays = Array.from(new Set(selectedValidDays)).sort((a, b) => a.localeCompare(b))
        const shouldUseSpecificDays = entryMode === "shift" || useSpecificDays

        if (shouldUseSpecificDays && selectedDays.length === 0) {
            alert("Selecciona al menos un dia valido")
            return
        }

        if (
            formData.isPackage &&
            formData.packageDaysCount &&
            shouldUseSpecificDays &&
            selectedDays.length > 0 &&
            formData.packageDaysCount > selectedDays.length
        ) {
            alert("El paquete no puede tener mas dias que los dias validos seleccionados")
            return
        }

        const validDaysPayload = shouldUseSpecificDays
            ? buildTicketValidDaysPayload({
                dates: selectedDays,
                shifts,
                requireShiftSelection: requireShiftSelection && shifts.length > 0,
            })
            : []

        setLoading(true)
        try {
            const url = "/api/ticket-types"
            const method = editingId ? "PUT" : "POST"
            const body = editingId
                ? { ...formData, id: editingId, capacity: capacityNumber, validDays: validDaysPayload }
                : { ...formData, eventId, capacity: capacityNumber, validDays: validDaysPayload }

            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })

            if (!response.ok) throw new Error("Error al guardar")

            const { data } = await response.json()

            if (editingId) {
                setTicketTypes(ticketTypes.map(t => t.id === editingId ? data : t))
            } else {
                setTicketTypes([...ticketTypes, data])
            }

            resetForm()
        } catch (error) {
            console.error(error)
            alert("Error al guardar tipo de entrada")
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Estas seguro?")) return

        try {
            const response = await fetch(`/api/ticket-types?id=${id}`, {
                method: "DELETE",
            })

            if (!response.ok) throw new Error("Error al eliminar")

            const data = await response.json()
            if (data.message.includes("desactivado")) {
                setTicketTypes(ticketTypes.map(t => t.id === id ? { ...t, isActive: false } : t))
            } else {
                setTicketTypes(ticketTypes.filter(t => t.id !== id))
            }
        } catch (error) {
            console.error(error)
            alert("Error al eliminar")
        }
    }

    const handleToggleActive = async (id: string, currentStatus: boolean) => {
        try {
            const response = await fetch("/api/ticket-types", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, isActive: !currentStatus }),
            })

            if (!response.ok) throw new Error("Error al actualizar")

            setTicketTypes(ticketTypes.map(t => 
                t.id === id ? { ...t, isActive: !currentStatus } : t
            ))
        } catch (error) {
            console.error(error)
            alert("Error al cambiar estado")
        }
    }

    return (
        <Card>
            <CardHeader className="space-y-3">
                <CardTitle>Entradas</CardTitle>
                {!isAdding && !editingId && (
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                setEntryMode("standard")
                                setAutoName(false)
                                setUseSpecificDays(false)
                                setFormData({
                                    name: "",
                                    description: "",
                                    price: 0,
                                    capacity: 100,
                                    isPackage: false,
                                    packageDaysCount: 0,
                                    sortOrder: 0,
                                })
                                setCapacityInput("100")
                                setSelectedValidDays([])
                                setShiftsInput("")
                                setRequireShiftSelection(true)
                                setIsAdding(true)
                            }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Tipo de Entrada
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                setEntryMode("shift")
                                setAutoName(true)
                                setUseSpecificDays(true)
                                setFormData({
                                    name: "",
                                    description: "",
                                    price: 0,
                                    capacity: 100,
                                    isPackage: false,
                                    packageDaysCount: 0,
                                    sortOrder: 0,
                                })
                                setCapacityInput("100")
                                setSelectedValidDays([])
                                setShiftsInput("")
                                setRequireShiftSelection(true)
                                setIsAdding(true)
                            }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Entrada con Turno
                        </Button>
                    </div>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                {(isAdding || editingId) && (
                    <div className="bg-gray-50 p-4 rounded-lg space-y-4 border">
                        <h4 className="font-medium text-sm">
                            {editingId
                                ? entryMode === "shift"
                                    ? "Editar Entrada con Turno"
                                    : "Editar Tipo de Entrada"
                                : entryMode === "shift"
                                  ? "Nueva Entrada con Turno"
                                  : "Nuevo Tipo de Entrada"}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Nombre</label>
                                <Input
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder={entryMode === "shift" ? "Ej: Turno Mañana" : "Ej: General, VIP"}
                                    readOnly={entryMode === "shift" && autoName}
                                />
                                {entryMode === "shift" && (
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <input
                                            type="checkbox"
                                            id="autoName"
                                            checked={autoName}
                                            onChange={(e) => setAutoName(e.target.checked)}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        <label htmlFor="autoName">Nombre automatico</label>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Descripcion (opcional)</label>
                                <Input
                                    value={formData.description || ""}
                                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                    placeholder="Detalle corto para el comprador"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Precio (S/)</label>
                                <Input
                                    type="number"
                                    value={formData.price}
                                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Capacidad (manual)</label>
                                <Input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={capacityInput}
                                    onChange={(e) => {
                                        const next = e.target.value.replace(/\D+/g, "")
                                        setCapacityInput(next)
                                        setFormData({ ...formData, capacity: next === "" ? 0 : Number(next) })
                                    }}
                                />
                            </div>
                            <div className="space-y-2 flex items-center gap-2 pt-6">
                                <input
                                    type="checkbox"
                                    id="isPackage"
                                    checked={formData.isPackage}
                                    onChange={(e) => setFormData({ ...formData, isPackage: e.target.checked })}
                                    className="h-4 w-4 rounded border-gray-300"
                                />
                                <label htmlFor="isPackage" className="text-sm">Paquete por cantidad de días</label>

                                {formData.isPackage && (
                                    <Input
                                        type="number"
                                        placeholder="N° días"
                                        className="w-20 h-8"
                                        value={formData.packageDaysCount || ""}
                                        min={1}
                                        onChange={(e) => setFormData({ ...formData, packageDaysCount: Number(e.target.value) })}
                                    />
                                )}
                            </div>
                        </div>
                        {formData.isPackage && (
                            <div className="text-xs text-gray-600">
                                Este ticket permitirá registrar hasta {formData.packageDaysCount || 0} días distintos del calendario que definas.
                            </div>
                        )}

                        {entryMode === "shift" && (
                        <div className="rounded-lg border bg-white p-3">
                            <div className="text-xs font-semibold text-gray-600 mb-3">
                                Constructor rapido de turno
                            </div>
                            <div className="mb-3 rounded-md border border-blue-100 bg-blue-50 p-3">
                                <div className="text-xs font-semibold text-blue-800 mb-2">
                                    Plantilla: Full day por N dias
                                </div>
                                <div className="flex flex-wrap items-end gap-2">
                                    <div className="space-y-1">
                                        <label className="text-[11px] text-blue-700">Cantidad de dias</label>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={fullDayPackageDays}
                                            onChange={(e) => setFullDayPackageDays(Math.max(1, Number(e.target.value) || 1))}
                                            className="h-9 w-28 bg-white"
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => {
                                            setAutoName(false)
                                            setFormData((prev) => ({
                                                ...prev,
                                                name: `Full day - ${fullDayPackageDays} días`,
                                                isPackage: true,
                                                packageDaysCount: fullDayPackageDays,
                                            }))
                                            setRequireShiftSelection(false)
                                            if (!shiftsInput.trim()) {
                                                setShiftsInput("Mañana, Tarde")
                                            }
                                        }}
                                    >
                                        Aplicar plantilla
                                    </Button>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-3">
                                {quickPresets.map((preset) => (
                                    <Button
                                        key={preset.label}
                                        type="button"
                                        size="sm"
                                        variant={daysLabel === preset.label ? "default" : "outline"}
                                        onClick={() => {
                                            setDaysLabel(preset.label)
                                            setSessionsPerWeek(preset.sessions)
                                            if (!customLabel.trim()) {
                                                setCustomLabel("")
                                            }
                                        }}
                                    >
                                        {preset.label}
                                    </Button>
                                ))}
                                <Input
                                    value={customLabel}
                                    onChange={(e) => setCustomLabel(e.target.value)}
                                    placeholder="Etiqueta personalizada (opcional)"
                                    className="h-9 w-60"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500">Inicio</label>
                                    <Input
                                        type="time"
                                        value={startTime}
                                        onChange={(e) => setStartTime(e.target.value)}
                                        className="h-9"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500">Fin</label>
                                    <Input
                                        type="time"
                                        value={endTime}
                                        onChange={(e) => setEndTime(e.target.value)}
                                        className="h-9"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500">Sesiones por semana</label>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={sessionsPerWeek}
                                        onChange={(e) => setSessionsPerWeek(Number(e.target.value))}
                                        className="h-9"
                                    />
                                </div>
                            </div>
                            {!autoName && (
                                <div className="mt-3 text-xs text-gray-500">
                                    Activa &quot;Nombre automatico&quot; para generar el titulo del turno.
                                </div>
                            )}
                        </div>
                        )}

                        {entryMode === "shift" && (
                        <div className="rounded-lg border bg-white p-3 space-y-3">
                            <div className="text-xs font-semibold text-gray-700">
                                Dias y turnos habilitados para esta entrada
                            </div>
                            <>
                                    {dateOptions.length > 0 ? (
                                        <div>
                                            <div className="text-xs text-gray-500 mb-2">
                                                Puedes seleccionar multiples dias
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {dateOptions.map((date) => {
                                                    const selected = selectedValidDays.includes(date)
                                                    return (
                                                        <Button
                                                            key={date}
                                                            type="button"
                                                            size="sm"
                                                            variant={selected ? "default" : "outline"}
                                                            onClick={() =>
                                                                setSelectedValidDays((prev) =>
                                                                    selected
                                                                        ? prev.filter((item) => item !== date)
                                                                        : [...prev, date]
                                                                )
                                                            }
                                                        >
                                                            {formatDate(date, { dateStyle: "medium" })}
                                                        </Button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="text-xs text-gray-500">
                                            Define fecha inicio/fin del evento para habilitar esta seleccion.
                                        </div>
                                    )}

                                    <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                                        <input
                                            type="checkbox"
                                            id="requireShiftSelection"
                                            checked={requireShiftSelection}
                                            onChange={(e) => setRequireShiftSelection(e.target.checked)}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        <label htmlFor="requireShiftSelection" className="text-xs text-gray-700">
                                            Requerir elegir turno en checkout
                                        </label>
                                    </div>

                                    <div className="space-y-1">
                                        <label className="text-xs text-gray-500">
                                            Turnos (separados por coma, opcional)
                                        </label>
                                        <Input
                                            value={shiftsInput}
                                            onChange={(e) => setShiftsInput(e.target.value)}
                                            placeholder="Mañana, Tarde, Noche"
                                            className="h-9"
                                        />
                                    </div>
                                    {!requireShiftSelection && (
                                        <div className="text-xs text-blue-700">
                                            Modo full day: con un solo QR del día, el ticket será válido para todos los turnos configurados.
                                        </div>
                                    )}
                                </>
                        </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                                Cancelar
                            </Button>
                            <Button type="button" size="sm" onClick={handleSave} loading={loading}>
                                <Save className="h-4 w-4 mr-2" />
                                Guardar
                            </Button>
                        </div>
                    </div>
                )}

                {[
                    { title: "Tipos de Entrada", items: standardTicketTypes, empty: "No hay tipos de entrada registrados" },
                    { title: "Entradas con Turno", items: shiftTicketTypes, empty: "No hay entradas con turno registradas" },
                ].map((section) => (
                    <div key={section.title} className="space-y-2">
                        <h4 className="text-sm font-semibold text-gray-700">{section.title}</h4>
                        {section.items.map((ticket) => {
                            const schedule = parseTicketScheduleConfig(ticket.validDays)

                            return (
                                <div
                                    key={ticket.id}
                                    className={`rounded-lg border p-3 ${ticket.isActive === false ? "bg-gray-100 opacity-70" : "bg-white"}`}
                                >
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="font-medium flex flex-wrap items-center gap-2">
                                                <span className="break-words">{ticket.name}</span>
                                                {ticket.isPackage && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        Paquete {ticket.packageDaysCount} dias
                                                    </Badge>
                                                )}
                                                {schedule.dates.length > 0 && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        {schedule.dates.length} dias
                                                    </Badge>
                                                )}
                                                {schedule.shifts.length > 0 && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        {schedule.shifts.length} turnos
                                                    </Badge>
                                                )}
                                                {schedule.shifts.length > 0 && !schedule.requireShiftSelection && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        Todos los turnos
                                                    </Badge>
                                                )}
                                                {ticket.isActive === false && (
                                                    <Badge variant="destructive" className="text-xs">Inactivo</Badge>
                                                )}
                                            </div>
                                            <div className="text-sm text-gray-500 break-words">
                                                {formatPrice(ticket.price)} • {ticket.sold || 0} / {ticket.capacity} vendidos
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 self-end shrink-0 sm:self-auto">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9"
                                                onClick={() => handleToggleActive(ticket.id!, ticket.isActive !== false)}
                                                title={ticket.isActive !== false ? "Desactivar" : "Activar"}
                                            >
                                                <Power className={`h-4 w-4 ${ticket.isActive !== false ? "text-green-500" : "text-gray-400"}`} />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9"
                                                onClick={() => {
                                                    const mode = isShiftTicketType(ticket) ? "shift" : "standard"
                                                    setEntryMode(mode)
                                                    setEditingId(ticket.id!)
                                                    setFormData(ticket)
                                                    setAutoName(false)
                                                    setIsAdding(false)
                                                    setCapacityInput(String(ticket.capacity ?? 0))
                                                    setUseSpecificDays(mode === "shift")
                                                    setSelectedValidDays(schedule.dates)
                                                    setShiftsInput(schedule.shifts.join(", "))
                                                    setRequireShiftSelection(schedule.requireShiftSelection)
                                                    setFullDayPackageDays(ticket.packageDaysCount ?? 4)
                                                }}
                                            >
                                                <Edit className="h-4 w-4 text-gray-500" />
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9"
                                                onClick={() => handleDelete(ticket.id!)}
                                            >
                                                <Trash2 className="h-4 w-4 text-red-500" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                        {section.items.length === 0 && !isAdding && (
                            <div className="text-center py-4 text-gray-500 text-sm border rounded-lg bg-gray-50">
                                {section.empty}
                            </div>
                        )}
                    </div>
                ))}
            </CardContent>
        </Card>
    )
}
