"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Edit, Save, Power, FileJson } from "lucide-react"
import { formatDate, formatPrice } from "@/lib/utils"
import { buildTicketValidDaysPayload, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import ServilexServiceCombobox from "@/components/admin/ServilexServiceCombobox"

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
    servilexEnabled?: boolean
    servilexIndicator?: string | null
    servilexSucursalCode?: string | null
    servilexServiceCode?: string | null
    servilexDisciplineCode?: string | null
    servilexScheduleCode?: string | null
    servilexPoolCode?: string | null
    servilexExtraConfig?: unknown
    servilexServiceId?: string | null
}

interface TicketTypeManagerProps {
    eventId: string
    initialTicketTypes: TicketType[]
    eventCategory?: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
    eventStartDate?: string | Date
    eventEndDate?: string | Date
}

interface ShiftEntry {
    name: string
    startTime: string
    endTime: string
}

type ServilexExtraConfig = {
    cantidad?: number | string
    descuento?: number | string
    horaInicio?: string
    horaFin?: string
    duracion?: number | string
}

const buildEmptyFormData = (): Partial<TicketType> => ({
    name: "",
    description: "",
    price: 0,
    capacity: 100,
    isPackage: false,
    packageDaysCount: 0,
    sortOrder: 0,
    servilexEnabled: false,
    servilexIndicator: "AC",
    servilexSucursalCode: "01",
    servilexServiceCode: "",
    servilexDisciplineCode: "",
    servilexScheduleCode: "",
    servilexPoolCode: "",
    servilexExtraConfig: {},
    servilexServiceId: null,
})

const serializeShifts = (entries: ShiftEntry[]): string[] => {
    return entries
        .filter((e) => e.name.trim())
        .map((e) => {
            const name = e.name.trim()
            if (e.startTime && e.endTime) {
                return `${name} (${e.startTime}-${e.endTime})`
            }
            return name
        })
}

const parseShiftString = (shift: string): ShiftEntry => {
    const match = shift.match(/^(.+?)\s*\((\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\)$/)
    if (match) {
        return { name: match[1].trim(), startTime: match[2], endTime: match[3] }
    }
    return { name: shift.trim(), startTime: "", endTime: "" }
}

const toUTCDateOnly = (value: string | Date): Date | null => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value)
    if (Number.isNaN(parsed.getTime())) return null
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
}

const getServilexExtraConfig = (value: unknown): ServilexExtraConfig => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as ServilexExtraConfig
}

const normalizeTicketTypeForForm = (ticket: TicketType): Partial<TicketType> => ({
    ...ticket,
    servilexIndicator: ticket.servilexIndicator || "AC",
    servilexSucursalCode: ticket.servilexSucursalCode || "01",
    servilexServiceCode: ticket.servilexServiceCode || "",
    servilexDisciplineCode: ticket.servilexDisciplineCode || "",
    servilexScheduleCode: ticket.servilexScheduleCode || "",
    servilexPoolCode: ticket.servilexPoolCode || "",
    servilexExtraConfig: getServilexExtraConfig(ticket.servilexExtraConfig),
    servilexServiceId: ticket.servilexServiceId || null,
})

export function TicketTypeManager({
    eventId,
    initialTicketTypes,
    eventCategory,
    eventStartDate,
    eventEndDate,
}: TicketTypeManagerProps) {
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>(initialTicketTypes)
    const [isAdding, setIsAdding] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [entryMode, setEntryMode] = useState<"standard" | "shift">("standard")
    const [loading, setLoading] = useState(false)

    const [selectedValidDays, setSelectedValidDays] = useState<string[]>([])
    const [shiftEntries, setShiftEntries] = useState<ShiftEntry[]>([])
    const [requireShiftSelection, setRequireShiftSelection] = useState(true)
    const [fullDayPackageDays, setFullDayPackageDays] = useState(4)

    const [formData, setFormData] = useState<Partial<TicketType>>(buildEmptyFormData)
    const [capacityInput, setCapacityInput] = useState("100")
    const usesDailyCapacity = eventCategory === "PISCINA_LIBRE"

    const [showPoolGenerator, setShowPoolGenerator] = useState(false)
    const [poolStartHour, setPoolStartHour] = useState(6)
    const [poolEndHour, setPoolEndHour] = useState(20)
    const [poolPrice, setPoolPrice] = useState("")
    const [poolCapacity, setPoolCapacity] = useState("30")
    const [poolGenerating, setPoolGenerating] = useState(false)
    const [poolProgress, setPoolProgress] = useState({ current: 0, total: 0 })

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

    const dateOptions = useMemo(() => {
        if (!eventStartDate || !eventEndDate) return []
        const start = toUTCDateOnly(eventStartDate)
        const end = toUTCDateOnly(eventEndDate)
        if (!start || !end) return []

        const options: string[] = []
        const current = new Date(start)
        while (current <= end) {
            const year = current.getUTCFullYear()
            const month = String(current.getUTCMonth() + 1).padStart(2, "0")
            const day = String(current.getUTCDate()).padStart(2, "0")
            options.push(`${year}-${month}-${day}`)
            current.setUTCDate(current.getUTCDate() + 1)
        }
        return options
    }, [eventStartDate, eventEndDate])

    const poolSlotsPreview = useMemo(() => {
        if (poolStartHour >= poolEndHour) return null
        const slots: string[] = []
        for (let h = poolStartHour; h < poolEndHour; h++) {
            slots.push(`${String(h).padStart(2, "0")}:00 - ${String(h + 1).padStart(2, "0")}:00`)
        }
        const existingNames = new Set(ticketTypes.map(t => t.name.trim()))
        const newSlots = slots.filter(s => !existingNames.has(s))
        return { slots, newCount: newSlots.length, skipCount: slots.length - newSlots.length }
    }, [poolStartHour, poolEndHour, ticketTypes])

    const updateShiftEntry = (index: number, field: keyof ShiftEntry, value: string) => {
        setShiftEntries((prev) =>
            prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry))
        )
    }

    const removeShiftEntry = (index: number) => {
        setShiftEntries((prev) => prev.filter((_, i) => i !== index))
    }

    const resetForm = () => {
        setFormData(buildEmptyFormData())
        setCapacityInput("100")
        setSelectedValidDays([])
        setShiftEntries([])
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

        const shifts = serializeShifts(shiftEntries)
        const selectedDays = Array.from(new Set(selectedValidDays)).sort((a, b) => a.localeCompare(b))
        const shouldUseSpecificDays = entryMode === "shift"

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

        const servilexIndicator = (formData.servilexIndicator || "AC").toUpperCase()
        const extraConfig = getServilexExtraConfig(formData.servilexExtraConfig)

        if (formData.servilexEnabled) {
            if (!formData.servilexSucursalCode || !String(formData.servilexSucursalCode).trim()) {
                alert("Completa el codigo de sucursal ABIO")
                return
            }
            if (!formData.servilexServiceId && !formData.servilexServiceCode) {
                alert("Selecciona o escribe un codigo de servicio Servilex")
                return
            }

            if (servilexIndicator === "AC") {
                const requiredServilexFields = [
                    formData.servilexDisciplineCode,
                    formData.servilexScheduleCode,
                    formData.servilexPoolCode,
                ]
                if (requiredServilexFields.some((value) => !String(value || "").trim())) {
                    alert("Completa los codigos de disciplina, horario y piscina para AC")
                    return
                }
            }

            if (servilexIndicator === "PN" || servilexIndicator === "PA") {
                if (!formData.servilexPoolCode || !String(formData.servilexPoolCode).trim()) {
                    alert("Completa el codigo de piscina para PN/PA")
                    return
                }
                if (!extraConfig.horaInicio || !extraConfig.horaFin || !Number(extraConfig.duracion)) {
                    alert("Completa hora inicio, hora fin y duracion para PN/PA")
                    return
                }
            }

            if (servilexIndicator === "OS") {
                const descuentoValue = extraConfig.descuento === undefined ? 0 : Number(extraConfig.descuento)
                if (!Number.isFinite(descuentoValue) || descuentoValue < 0) {
                    alert("El descuento Servilex debe ser un numero mayor o igual a 0")
                    return
                }
            }

            if (
                extraConfig.cantidad !== undefined &&
                (!Number.isFinite(Number(extraConfig.cantidad)) || Number(extraConfig.cantidad) <= 0)
            ) {
                alert("La cantidad Servilex debe ser mayor a 0")
                return
            }
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

    const handlePoolGenerate = async () => {
        if (poolStartHour >= poolEndHour) {
            alert("La hora de inicio debe ser menor a la hora de fin")
            return
        }
        const priceNumber = Number(poolPrice)
        if (!Number.isFinite(priceNumber) || priceNumber < 0) {
            alert("Precio invalido")
            return
        }
        const capNumber = Number(poolCapacity)
        if (!Number.isFinite(capNumber) || capNumber < 0) {
            alert("Capacidad invalida")
            return
        }

        const slots: { name: string }[] = []
        for (let h = poolStartHour; h < poolEndHour; h++) {
            const start = `${String(h).padStart(2, "0")}:00`
            const end = `${String(h + 1).padStart(2, "0")}:00`
            slots.push({ name: `${start} - ${end}` })
        }

        const existingNames = new Set(ticketTypes.map(t => t.name.trim()))
        const slotsToCreate = slots.filter(s => !existingNames.has(s.name))

        if (slotsToCreate.length === 0) {
            alert("Todos los horarios ya existen")
            return
        }

        const skipped = slots.length - slotsToCreate.length
        const msg = skipped > 0
            ? `Se crearan ${slotsToCreate.length} horarios (${skipped} ya existen y se omitiran). Continuar?`
            : `Se crearan ${slotsToCreate.length} horarios de 1 hora. Continuar?`
        if (!confirm(msg)) return

        const maxSort = ticketTypes.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), 0)

        setPoolGenerating(true)
        setPoolProgress({ current: 0, total: slotsToCreate.length })
        const created: TicketType[] = []
        const errors: string[] = []

        for (let i = 0; i < slotsToCreate.length; i++) {
            const slot = slotsToCreate[i]
            setPoolProgress({ current: i + 1, total: slotsToCreate.length })

            try {
                const response = await fetch("/api/ticket-types", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        eventId,
                        name: slot.name,
                        price: priceNumber,
                        capacity: capNumber,
                        sortOrder: maxSort + i + 1,
                        isActive: true,
                        validDays: [],
                    }),
                })
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                const { data } = await response.json()
                created.push(data)
            } catch (err) {
                errors.push(`${slot.name}: ${err instanceof Error ? err.message : "Error"}`)
            }
        }

        if (created.length > 0) {
            setTicketTypes(prev => [...prev, ...created])
        }

        setPoolGenerating(false)

        if (errors.length === 0) {
            alert(`${created.length} horarios creados exitosamente`)
            setShowPoolGenerator(false)
        } else {
            alert(`Se crearon ${created.length} horarios. ${errors.length} fallaron:\n${errors.join("\n")}`)
        }
    }

    const currentServilexIndicator = (formData.servilexIndicator || "AC").toUpperCase()
    const currentServilexExtraConfig = getServilexExtraConfig(formData.servilexExtraConfig)

    const updateServilexExtraConfig = (
        field: keyof ServilexExtraConfig,
        value: string
    ) => {
        setFormData((prev) => ({
            ...prev,
            servilexExtraConfig: {
                ...getServilexExtraConfig(prev.servilexExtraConfig),
                [field]: value,
            },
        }))
    }

    return (
        <Card>
            <CardHeader className="space-y-3">
                <CardTitle>Entradas</CardTitle>
                {!isAdding && !editingId && !showPoolGenerator && (
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                setEntryMode("standard")
                                setFormData(buildEmptyFormData())
                                setCapacityInput("100")
                                setSelectedValidDays([])
                                setShiftEntries([])
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
                                setFormData(buildEmptyFormData())
                                setCapacityInput("100")
                                setSelectedValidDays([])
                                setShiftEntries([])
                                setRequireShiftSelection(true)
                                setFullDayPackageDays(4)
                                setIsAdding(true)
                            }}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Entrada con Turno
                        </Button>
                        {usesDailyCapacity && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setShowPoolGenerator(true)}
                            >
                                <Plus className="h-4 w-4 mr-2" />
                                Generar Horarios
                            </Button>
                        )}
                    </div>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                {showPoolGenerator && (
                    <div className="bg-blue-50 p-4 rounded-lg space-y-4 border border-blue-200">
                        <h4 className="font-medium text-sm">Generar Horarios de Piscina Libre</h4>
                        <p className="text-xs text-gray-600">
                            Define el rango de horas y se creara una entrada por cada hora. Luego puedes ajustar la capacidad de cada horario individualmente.
                        </p>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <div>
                                <label className="text-xs font-medium text-gray-700">Hora inicio</label>
                                <select
                                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                                    value={poolStartHour}
                                    onChange={e => setPoolStartHour(Number(e.target.value))}
                                    disabled={poolGenerating}
                                >
                                    {Array.from({ length: 24 }, (_, i) => (
                                        <option key={i} value={i}>
                                            {String(i).padStart(2, "0")}:00
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700">Hora fin</label>
                                <select
                                    className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                                    value={poolEndHour}
                                    onChange={e => setPoolEndHour(Number(e.target.value))}
                                    disabled={poolGenerating}
                                >
                                    {Array.from({ length: 24 }, (_, i) => i + 1).filter(h => h > poolStartHour).map(h => (
                                        <option key={h} value={h}>
                                            {String(h).padStart(2, "0")}:00
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700">Precio (S/)</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={poolPrice}
                                    onChange={e => setPoolPrice(e.target.value)}
                                    disabled={poolGenerating}
                                    placeholder="0.00"
                                    className="mt-1"
                                />
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-700">Capacidad por dia</label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={poolCapacity}
                                    onChange={e => setPoolCapacity(e.target.value)}
                                    disabled={poolGenerating}
                                    placeholder="30"
                                    className="mt-1"
                                />
                            </div>
                        </div>

                        {poolSlotsPreview && (
                            <div className="text-xs text-gray-600 space-y-1">
                                <p>
                                    <span className="font-medium">{poolSlotsPreview.newCount}</span> horarios por crear
                                    {poolSlotsPreview.skipCount > 0 && (
                                        <span className="text-amber-600"> ({poolSlotsPreview.skipCount} ya existen)</span>
                                    )}
                                </p>
                                <p className="text-gray-400">
                                    {poolSlotsPreview.slots.join(", ")}
                                </p>
                            </div>
                        )}

                        {poolGenerating && (
                            <div className="text-sm text-blue-700 font-medium">
                                Creando horario {poolProgress.current} de {poolProgress.total}...
                            </div>
                        )}

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setShowPoolGenerator(false)}
                                disabled={poolGenerating}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                onClick={handlePoolGenerate}
                                disabled={poolGenerating || !poolSlotsPreview || poolSlotsPreview.newCount === 0}
                            >
                                {poolGenerating
                                    ? "Generando..."
                                    : `Generar ${poolSlotsPreview?.newCount ?? 0} horarios`}
                            </Button>
                        </div>
                    </div>
                )}

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
                                    placeholder={entryMode === "shift" ? "Ej: Full day - 3 días" : "Ej: General, VIP"}
                                />
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
                                <label className="text-xs font-medium">
                                    {usesDailyCapacity ? "Capacidad por dia" : "Capacidad (manual)"}
                                </label>
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

                        {usesDailyCapacity && (
                            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                                Para piscina libre, cada tipo de entrada representa un horario. La capacidad se aplica por cada dia del rango del evento y el comprador elegira la fecha en checkout.
                            </div>
                        )}

                        <div className="rounded-lg border bg-white p-3 space-y-3">
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="servilexEnabled"
                                    checked={Boolean(formData.servilexEnabled)}
                                    onChange={(e) => setFormData({
                                        ...formData,
                                        servilexEnabled: e.target.checked,
                                        servilexIndicator: e.target.checked
                                            ? (formData.servilexIndicator || "AC")
                                            : "",
                                    })}
                                    className="h-4 w-4 rounded border-gray-300"
                                />
                                <label htmlFor="servilexEnabled" className="text-sm font-medium">
                                    Requiere integracion Servilex / ABIO
                                </label>
                            </div>
                            {formData.servilexEnabled && (
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium">Indicador ABIO</label>
                                            <select
                                                value={currentServilexIndicator}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        servilexIndicator: e.target.value,
                                                        servilexServiceId: null,
                                                    }))
                                                }
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                            >
                                                <option value="AC">AC · Academia</option>
                                                <option value="OS">OS · Otros servicios</option>
                                                <option value="PN">PN · Piscina no afiliado</option>
                                                <option value="PA">PA · Piscina afiliado</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium">Sucursal ABIO</label>
                                            <Input
                                                value={formData.servilexSucursalCode || ""}
                                                onChange={(e) =>
                                                    setFormData({ ...formData, servilexSucursalCode: e.target.value })
                                                }
                                                placeholder="01"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium">Codigo servicio ABIO</label>
                                            <Input
                                                value={formData.servilexServiceCode || ""}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        servilexServiceCode: e.target.value,
                                                        servilexServiceId: null,
                                                    }))
                                                }
                                                placeholder="082"
                                            />
                                        </div>
                                    </div>

                                    <ServilexServiceCombobox
                                        value={formData.servilexServiceId || null}
                                        onChange={(service) => {
                                            if (service) {
                                                setFormData({
                                                    ...formData,
                                                    servilexServiceId: service.id,
                                                    servilexIndicator: service.indicador,
                                                    servilexServiceCode: service.codigo,
                                                })
                                            } else {
                                                setFormData({
                                                    ...formData,
                                                    servilexServiceId: null,
                                                })
                                            }
                                        }}
                                        legacyIndicator={formData.servilexIndicator}
                                        legacyServiceCode={formData.servilexServiceCode}
                                    />
                                    <div className="rounded-md border border-dashed bg-gray-50 p-3 text-xs text-gray-600">
                                        Puedes vincular un servicio del catalogo para autocompletar codigo e indicador,
                                        o escribirlos manualmente para OS, PN y PA.
                                    </div>

                                    {currentServilexIndicator === "AC" && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Codigo disciplina</label>
                                                <Input
                                                    value={formData.servilexDisciplineCode || ""}
                                                    onChange={(e) => setFormData({ ...formData, servilexDisciplineCode: e.target.value })}
                                                    placeholder="00"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Codigo horario</label>
                                                <Input
                                                    value={formData.servilexScheduleCode || ""}
                                                    onChange={(e) => setFormData({ ...formData, servilexScheduleCode: e.target.value })}
                                                    placeholder="000001"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Codigo piscina</label>
                                                <Input
                                                    value={formData.servilexPoolCode || ""}
                                                    onChange={(e) => setFormData({ ...formData, servilexPoolCode: e.target.value })}
                                                    placeholder="01"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {currentServilexIndicator === "OS" && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Cantidad</label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={currentServilexExtraConfig.cantidad ?? ""}
                                                    onChange={(e) => updateServilexExtraConfig("cantidad", e.target.value)}
                                                    placeholder="1"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Descuento</label>
                                                <Input
                                                    type="number"
                                                    min={0}
                                                    step="0.01"
                                                    value={currentServilexExtraConfig.descuento ?? ""}
                                                    onChange={(e) => updateServilexExtraConfig("descuento", e.target.value)}
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {(currentServilexIndicator === "PN" || currentServilexIndicator === "PA") && (
                                        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Codigo piscina</label>
                                                <Input
                                                    value={formData.servilexPoolCode || ""}
                                                    onChange={(e) => setFormData({ ...formData, servilexPoolCode: e.target.value })}
                                                    placeholder="01"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Cantidad</label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    value={currentServilexExtraConfig.cantidad ?? ""}
                                                    onChange={(e) => updateServilexExtraConfig("cantidad", e.target.value)}
                                                    placeholder="1"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Hora inicio</label>
                                                <Input
                                                    type="time"
                                                    value={currentServilexExtraConfig.horaInicio || ""}
                                                    onChange={(e) => updateServilexExtraConfig("horaInicio", e.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Hora fin</label>
                                                <Input
                                                    type="time"
                                                    value={currentServilexExtraConfig.horaFin || ""}
                                                    onChange={(e) => updateServilexExtraConfig("horaFin", e.target.value)}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Duracion</label>
                                                <Input
                                                    type="number"
                                                    min={1}
                                                    step="0.01"
                                                    value={currentServilexExtraConfig.duracion ?? ""}
                                                    onChange={(e) => updateServilexExtraConfig("duracion", e.target.value)}
                                                    placeholder="1"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {entryMode === "shift" && (
                        <>
                            {/* Plantilla rapida */}
                            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                                <div className="text-sm font-semibold text-blue-800 mb-2">
                                    Plantilla rapida
                                </div>
                                <div className="flex flex-wrap items-end gap-3">
                                    <div className="space-y-1">
                                        <label className="text-xs text-blue-700">Full Day por</label>
                                        <Input
                                            type="number"
                                            min={1}
                                            value={fullDayPackageDays}
                                            onChange={(e) => setFullDayPackageDays(Math.max(1, Number(e.target.value) || 1))}
                                            className="h-9 w-20 bg-white"
                                        />
                                    </div>
                                    <span className="text-sm text-blue-700 pb-2">días</span>
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={() => {
                                            setFormData((prev) => ({
                                                ...prev,
                                                name: `Full day - ${fullDayPackageDays} días`,
                                                isPackage: true,
                                                packageDaysCount: fullDayPackageDays,
                                            }))
                                            setSelectedValidDays([...dateOptions])
                                            setRequireShiftSelection(false)
                                            if (shiftEntries.length === 0) {
                                                setShiftEntries([
                                                    { name: "Mañana", startTime: "09:00", endTime: "12:00" },
                                                    { name: "Tarde", startTime: "14:00", endTime: "18:00" },
                                                ])
                                            }
                                        }}
                                    >
                                        Aplicar plantilla
                                    </Button>
                                </div>
                            </div>

                            {/* Dias validos */}
                            <div className="rounded-lg border bg-white p-3 space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="text-xs font-semibold text-gray-700">Días válidos</div>
                                    {dateOptions.length > 0 && (
                                        <div className="flex gap-2">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setSelectedValidDays([...dateOptions])}
                                            >
                                                Seleccionar todos
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => setSelectedValidDays([])}
                                            >
                                                Ninguno
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                {dateOptions.length > 0 ? (
                                    <>
                                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
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
                                        <div className="text-xs text-gray-500">
                                            {selectedValidDays.length} de {dateOptions.length} días seleccionados
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-xs text-gray-500">
                                        Define fecha inicio/fin del evento para habilitar esta seleccion.
                                    </div>
                                )}
                            </div>

                            {/* Turnos */}
                            <div className="rounded-lg border bg-white p-3 space-y-3">
                                <div className="text-xs font-semibold text-gray-700">Turnos</div>

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

                                <div className="space-y-2">
                                    {shiftEntries.map((entry, index) => (
                                        <div key={index} className="flex items-center gap-2">
                                            <Input
                                                value={entry.name}
                                                onChange={(e) => updateShiftEntry(index, "name", e.target.value)}
                                                placeholder="Nombre del turno"
                                                className="h-9 flex-1"
                                            />
                                            <Input
                                                type="time"
                                                value={entry.startTime}
                                                onChange={(e) => updateShiftEntry(index, "startTime", e.target.value)}
                                                className="h-9 w-28"
                                            />
                                            <span className="text-xs text-gray-400">-</span>
                                            <Input
                                                type="time"
                                                value={entry.endTime}
                                                onChange={(e) => updateShiftEntry(index, "endTime", e.target.value)}
                                                className="h-9 w-28"
                                            />
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9 shrink-0"
                                                onClick={() => removeShiftEntry(index)}
                                            >
                                                <Trash2 className="h-4 w-4 text-red-400" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>

                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShiftEntries((prev) => [...prev, { name: "", startTime: "", endTime: "" }])}
                                >
                                    <Plus className="h-4 w-4 mr-1" />
                                    Agregar turno
                                </Button>

                                {!requireShiftSelection && shiftEntries.length > 0 && (
                                    <div className="text-xs text-blue-700">
                                        Modo full day: con un solo QR del día, el ticket será válido para todos los turnos configurados.
                                    </div>
                                )}
                            </div>
                        </>
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
                                                {ticket.servilexEnabled && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        ABIO {(ticket.servilexIndicator || "AC").toUpperCase()}
                                                        {ticket.servilexSucursalCode ? ` · ${ticket.servilexSucursalCode}` : ""}
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
                                            {ticket.servilexEnabled && (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-9 w-9"
                                                    title="Preview JSON Servilex"
                                                    onClick={() => window.open(`/api/admin/servilex-preview?ticketTypeId=${ticket.id}`, "_blank")}
                                                >
                                                    <FileJson className="h-4 w-4 text-blue-500" />
                                                </Button>
                                            )}
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="h-9 w-9"
                                                onClick={() => {
                                                    const mode = isShiftTicketType(ticket) ? "shift" : "standard"
                                                    setEntryMode(mode)
                                                    setEditingId(ticket.id!)
                                                    setFormData(normalizeTicketTypeForForm(ticket))
                                                    setIsAdding(false)
                                                    setCapacityInput(String(ticket.capacity ?? 0))
                                                    setSelectedValidDays(schedule.dates)
                                                    setShiftEntries(schedule.shifts.map(parseShiftString))
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
