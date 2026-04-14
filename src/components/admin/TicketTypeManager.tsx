"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Edit, Save, Power, FileJson } from "lucide-react"
import { formatDate, formatPrice } from "@/lib/utils"
import { buildTicketValidDaysPayload, parseTicketScheduleConfig } from "@/lib/ticket-schedule"
import ServilexServiceCombobox from "@/components/admin/ServilexServiceCombobox"
import { AbioCatalogControls } from "@/components/admin/AbioCatalogControls"
import { AbioBindingSelector } from "@/components/admin/AbioBindingSelector"

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
    servilexBindingId?: string | null
    dateInventories?: Array<{
        id?: string
        date: string | Date
        capacity: number
        sold: number
        isEnabled: boolean
    }>
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
    servilexBindingId: null,
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

const toDateKeyUTC = (value: string | Date): string | null => {
    const parsed = toUTCDateOnly(value)
    if (!parsed) return null
    const year = parsed.getUTCFullYear()
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0")
    const day = String(parsed.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

const getServilexExtraConfig = (value: unknown): ServilexExtraConfig => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {}
    return value as ServilexExtraConfig
}

type PoolGeneratedSlot = {
    name: string
    startTime: string
    endTime: string
    duration: number
}

type PoolGeneratorBinding = {
    id: string
    piscinaCodigo: string
    horarioCodigo: string
    numeroCupos: number
    scheduleDescription?: string | null
    horaInicio?: string | null
    horaFin?: string | null
    duracionHoras?: number | null
}

const buildPoolGeneratedSlots = (startHour: number, endHour: number): PoolGeneratedSlot[] => {
    const slots: PoolGeneratedSlot[] = []
    for (let h = startHour; h < endHour; h++) {
        const startTime = `${String(h).padStart(2, "0")}:00`
        const endTime = `${String(h + 1).padStart(2, "0")}:00`
        slots.push({
            name: `${startTime} - ${endTime}`,
            startTime,
            endTime,
            duration: h + 1 - h,
        })
    }
    return slots
}

const buildPoolSlotNameFromBinding = (binding: PoolGeneratorBinding): string => {
    const horaInicio = typeof binding.horaInicio === "string" ? binding.horaInicio.trim() : ""
    const horaFin = typeof binding.horaFin === "string" ? binding.horaFin.trim() : ""
    if (horaInicio && horaFin) {
        return `${horaInicio} - ${horaFin}`
    }

    if (binding.scheduleDescription && binding.scheduleDescription.trim()) {
        return binding.scheduleDescription.trim()
    }

    return `Horario ${binding.horarioCodigo}`
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
    servilexBindingId: ticket.servilexBindingId || null,
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
    const [poolBindings, setPoolBindings] = useState<PoolGeneratorBinding[]>([])
    const [poolBindingsLoading, setPoolBindingsLoading] = useState(false)
    const [dateToggleLoading, setDateToggleLoading] = useState<Record<string, boolean>>({})
    const [catalogRefreshKey, setCatalogRefreshKey] = useState(0)
    const [showInactive, setShowInactive] = useState(false)

    const inactiveCount = ticketTypes.filter((t) => t.isActive === false).length
    const configuredShiftCount = shiftEntries.filter((entry) => entry.name.trim()).length
    const scheduleMode = requireShiftSelection ? "per_shift" : "full_day"

    const isShiftTicketType = (ticket: TicketType) => {
        const schedule = parseTicketScheduleConfig(ticket.validDays)
        return schedule.dates.length > 0 || schedule.shifts.length > 0
    }

    const getScheduleModeForTicket = (ticket: TicketType) => {
        const schedule = parseTicketScheduleConfig(ticket.validDays)
        if (schedule.dates.length === 0 && schedule.shifts.length === 0) return "standard" as const
        if (schedule.shifts.length === 0) return "full_day" as const
        if (schedule.requireShiftSelection) return "per_shift" as const
        return "full_day" as const
    }

    const visibleTicketTypes = useMemo(
        () => showInactive ? ticketTypes : ticketTypes.filter((t) => t.isActive !== false),
        [ticketTypes, showInactive]
    )
    const standardTicketTypes = useMemo(
        () => visibleTicketTypes.filter((ticket) => getScheduleModeForTicket(ticket) === "standard"),
        [visibleTicketTypes]
    )
    const perShiftTicketTypes = useMemo(
        () => visibleTicketTypes.filter((ticket) => getScheduleModeForTicket(ticket) === "per_shift"),
        [visibleTicketTypes]
    )
    const fullDayTicketTypes = useMemo(
        () => visibleTicketTypes.filter((ticket) => getScheduleModeForTicket(ticket) === "full_day"),
        [visibleTicketTypes]
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

    useEffect(() => {
        const currentPoolIndicator = (formData.servilexIndicator || "PN").toUpperCase()
        const shouldLoadBindings =
            showPoolGenerator &&
            usesDailyCapacity &&
            Boolean(formData.servilexEnabled) &&
            (currentPoolIndicator === "PN" || currentPoolIndicator === "PA") &&
            Boolean(String(formData.servilexSucursalCode || "").trim()) &&
            Boolean(String(formData.servilexServiceCode || "").trim())

        if (!shouldLoadBindings) {
            setPoolBindings([])
            setPoolBindingsLoading(false)
            return
        }

        const query = new URLSearchParams({
            sucursal: String(formData.servilexSucursalCode || "").trim(),
            servicio: String(formData.servilexServiceCode || "").trim(),
        })
        if (formData.servilexDisciplineCode) {
            query.set("disciplina", String(formData.servilexDisciplineCode).trim())
        }
        if (formData.servilexPoolCode) {
            query.set("piscina", String(formData.servilexPoolCode).trim())
        }

        let ignore = false
        setPoolBindingsLoading(true)
        void fetch(`/api/admin/abio-catalog/bindings?${query.toString()}`, {
            cache: "no-store",
        })
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}))
                if (!response.ok) {
                    throw new Error(payload.error || "No se pudieron cargar los bindings ABIO")
                }
                if (ignore) return
                setPoolBindings(
                    Array.isArray(payload.data)
                        ? payload.data.map((binding: Record<string, unknown>) => ({
                              id: String(binding.id),
                              piscinaCodigo: String(binding.piscinaCodigo || ""),
                              horarioCodigo: String(binding.horarioCodigo || ""),
                              numeroCupos: Number(binding.numeroCupos || 0),
                              scheduleDescription:
                                  typeof binding.scheduleDescription === "string"
                                      ? binding.scheduleDescription
                                      : null,
                              horaInicio:
                                  typeof binding.horaInicio === "string" ? binding.horaInicio : null,
                              horaFin: typeof binding.horaFin === "string" ? binding.horaFin : null,
                              duracionHoras:
                                  binding.duracionHoras !== null &&
                                  binding.duracionHoras !== undefined &&
                                  Number.isFinite(Number(binding.duracionHoras))
                                      ? Number(binding.duracionHoras)
                                      : null,
                          }))
                        : []
                )
            })
            .catch((error) => {
                console.error("Error loading pool ABIO bindings", error)
                if (!ignore) {
                    setPoolBindings([])
                }
            })
            .finally(() => {
                if (!ignore) {
                    setPoolBindingsLoading(false)
                }
            })

        return () => {
            ignore = true
        }
    }, [
        showPoolGenerator,
        usesDailyCapacity,
        formData.servilexEnabled,
        formData.servilexIndicator,
        formData.servilexSucursalCode,
        formData.servilexServiceCode,
        formData.servilexDisciplineCode,
        formData.servilexPoolCode,
    ])

    const currentPoolIndicatorForGenerator = (formData.servilexIndicator || "PN").toUpperCase()
    const poolBindingMode =
        usesDailyCapacity &&
        Boolean(formData.servilexEnabled) &&
        (currentPoolIndicatorForGenerator === "PN" || currentPoolIndicatorForGenerator === "PA")
    const existingBindingIds = useMemo(
        () => new Set(ticketTypes.map((ticket) => ticket.servilexBindingId).filter(Boolean)),
        [ticketTypes]
    )
    const existingTicketNames = useMemo(
        () => new Set(ticketTypes.map((ticket) => ticket.name.trim())),
        [ticketTypes]
    )
    const poolBindingsToCreate = useMemo(
        () =>
            poolBindings.filter((binding) => {
                const bindingName = buildPoolSlotNameFromBinding(binding)
                return !existingBindingIds.has(binding.id) && !existingTicketNames.has(bindingName)
            }),
        [poolBindings, existingBindingIds, existingTicketNames]
    )

    const poolSlotsPreview = useMemo(() => {
        if (poolBindingMode) {
            return {
                mode: "bindings" as const,
                rows: poolBindings.map((binding) => ({
                    id: binding.id,
                    label: `${buildPoolSlotNameFromBinding(binding)} · Piscina ${binding.piscinaCodigo} · Cupos ${binding.numeroCupos}`,
                })),
                newCount: poolBindingsToCreate.length,
                skipCount: poolBindings.length - poolBindingsToCreate.length,
            }
        }

        if (poolStartHour >= poolEndHour) return null
        const slots: string[] = []
        for (let h = poolStartHour; h < poolEndHour; h++) {
            slots.push(`${String(h).padStart(2, "0")}:00 - ${String(h + 1).padStart(2, "0")}:00`)
        }
        const newSlots = slots.filter((slot) => !existingTicketNames.has(slot))
        return {
            mode: "manual" as const,
            slots,
            newCount: newSlots.length,
            skipCount: slots.length - newSlots.length,
        }
    }, [
        poolBindingMode,
        poolBindings,
        poolBindingsToCreate,
        poolStartHour,
        poolEndHour,
        existingTicketNames,
    ])

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

    const startStandardTicket = () => {
        setEntryMode("standard")
        setFormData(buildEmptyFormData())
        setCapacityInput("100")
        setSelectedValidDays([])
        setShiftEntries([])
        setRequireShiftSelection(true)
        setFullDayPackageDays(4)
        setIsAdding(true)
    }

    const startPerShiftTicket = () => {
        setEntryMode("shift")
        setFormData({
            ...buildEmptyFormData(),
            isPackage: false,
            packageDaysCount: 0,
        })
        setCapacityInput("100")
        setSelectedValidDays([])
        setShiftEntries([])
        setRequireShiftSelection(true)
        setFullDayPackageDays(4)
        setIsAdding(true)
    }

    const startFullDayTicket = () => {
        setEntryMode("shift")
        setFormData({
            ...buildEmptyFormData(),
            isPackage: false,
            packageDaysCount: 1,
        })
        setCapacityInput("100")
        setSelectedValidDays([...dateOptions])
        setShiftEntries([])
        setRequireShiftSelection(false)
        setFullDayPackageDays(4)
        setIsAdding(true)
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
        const ticket = ticketTypes.find((t) => t.id === id)
        const hasSales = ticket && (ticket.sold ?? 0) > 0
        const message = hasSales
            ? `"${ticket.name}" tiene ${ticket.sold} ventas. Se desactivara (no se puede eliminar con ventas). Continuar?`
            : `Eliminar "${ticket?.name || "entrada"}" permanentemente?`
        if (!confirm(message)) return

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

    const handleToggleDateAvailability = async (
        ticketId: string,
        date: string,
        nextEnabled: boolean
    ) => {
        const loadingKey = `${ticketId}:${date}`
        setDateToggleLoading((prev) => ({ ...prev, [loadingKey]: true }))

        try {
            const response = await fetch("/api/ticket-types", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: ticketId,
                    dateInventoryDate: date,
                    dateInventoryEnabled: nextEnabled,
                }),
            })

            if (!response.ok) throw new Error("Error al actualizar disponibilidad")

            const { data } = await response.json()
            const normalizedDateKey = toDateKeyUTC(data?.date || date) || date

            setTicketTypes((prev) =>
                prev.map((ticket) => {
                    if (ticket.id !== ticketId) return ticket

                    const currentInventories = ticket.dateInventories ?? []
                    const existingIndex = currentInventories.findIndex(
                        (inventory) => toDateKeyUTC(inventory.date) === normalizedDateKey
                    )

                    const nextInventory = {
                        id: data?.id,
                        date: data?.date || date,
                        capacity: Number(data?.capacity ?? ticket.capacity),
                        sold: Number(data?.sold ?? 0),
                        isEnabled: Boolean(data?.isEnabled),
                    }

                    if (existingIndex === -1) {
                        return {
                            ...ticket,
                            dateInventories: [...currentInventories, nextInventory],
                        }
                    }

                    return {
                        ...ticket,
                        dateInventories: currentInventories.map((inventory, index) =>
                            index === existingIndex ? nextInventory : inventory
                        ),
                    }
                })
            )
        } catch (error) {
            console.error(error)
            alert("No se pudo actualizar la fecha para este horario")
        } finally {
            setDateToggleLoading((prev) => {
                const next = { ...prev }
                delete next[loadingKey]
                return next
            })
        }
    }

    const handlePoolGenerate = async () => {
        const priceNumber = Number(poolPrice)
        if (!Number.isFinite(priceNumber) || priceNumber < 0) {
            alert("Precio invalido")
            return
        }

        const currentPoolExtraConfig = getServilexExtraConfig(formData.servilexExtraConfig)
        const currentPoolIndicator = (formData.servilexIndicator || "PN").toUpperCase()
        const useBindingGeneration =
            Boolean(formData.servilexEnabled) &&
            usesDailyCapacity &&
            (currentPoolIndicator === "PN" || currentPoolIndicator === "PA")

        if (formData.servilexEnabled) {
            if (currentPoolIndicator !== "PN" && currentPoolIndicator !== "PA") {
                alert("Para el generador de piscina libre, el indicador ABIO debe ser PN o PA")
                return
            }
            if (!formData.servilexSucursalCode || !String(formData.servilexSucursalCode).trim()) {
                alert("Completa la sucursal ABIO para generar horarios integrados")
                return
            }
            if (!formData.servilexServiceCode || !String(formData.servilexServiceCode).trim()) {
                alert("Completa el codigo de servicio ABIO para generar horarios integrados")
                return
            }
            if (!formData.servilexPoolCode || !String(formData.servilexPoolCode).trim()) {
                alert("Completa el codigo de piscina para generar horarios integrados")
                return
            }
            if (
                currentPoolExtraConfig.cantidad !== undefined &&
                (!Number.isFinite(Number(currentPoolExtraConfig.cantidad)) || Number(currentPoolExtraConfig.cantidad) <= 0)
            ) {
                alert("La cantidad Servilex debe ser mayor a 0")
                return
            }
        }

        if (useBindingGeneration) {
            if (poolBindings.length === 0) {
                alert("No hay bindings ABIO activos para este servicio de piscina libre. Sincroniza catalogo, importa la tabla de amarre o ajusta sucursal/servicio/piscina.")
                return
            }
        } else {
            if (poolStartHour >= poolEndHour) {
                alert("La hora de inicio debe ser menor a la hora de fin")
                return
            }
            const capNumber = Number(poolCapacity)
            if (!Number.isFinite(capNumber) || capNumber < 0) {
                alert("Capacidad invalida")
                return
            }
        }

        const slots = useBindingGeneration ? [] : buildPoolGeneratedSlots(poolStartHour, poolEndHour)
        const slotsToCreate = useBindingGeneration
            ? poolBindingsToCreate
            : slots.filter((slot) => !existingTicketNames.has(slot.name))

        if (slotsToCreate.length === 0) {
            alert(useBindingGeneration ? "Todos los bindings ABIO de piscina libre ya existen como entradas" : "Todos los horarios ya existen")
            return
        }

        const skipped = useBindingGeneration
            ? poolBindings.length - poolBindingsToCreate.length
            : slots.length - slotsToCreate.length
        const msg = skipped > 0
            ? useBindingGeneration
                ? `Se crearan ${slotsToCreate.length} horarios desde ABIO (${skipped} ya existen y se omitiran). Continuar?`
                : `Se crearan ${slotsToCreate.length} horarios (${skipped} ya existen y se omitiran). Continuar?`
            : useBindingGeneration
                ? `Se crearan ${slotsToCreate.length} horarios desde la tabla de amarre ABIO. Continuar?`
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
                const extraConfig = getServilexExtraConfig(formData.servilexExtraConfig)
                const bindingSlot = useBindingGeneration ? (slot as PoolGeneratorBinding) : null
                const manualSlot = useBindingGeneration ? null : (slot as PoolGeneratedSlot)
                const ticketName = bindingSlot
                    ? buildPoolSlotNameFromBinding(bindingSlot)
                    : manualSlot?.name || ""
                const response = await fetch("/api/ticket-types", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        eventId,
                        name: ticketName,
                        price: priceNumber,
                        capacity: bindingSlot?.numeroCupos ?? Number(poolCapacity),
                        sortOrder: maxSort + i + 1,
                        isActive: true,
                        validDays: [],
                        servilexEnabled: Boolean(formData.servilexEnabled),
                        servilexIndicator: currentPoolIndicator,
                        servilexBindingId: bindingSlot?.id || null,
                        servilexSucursalCode: formData.servilexSucursalCode,
                        servilexServiceCode: formData.servilexServiceCode,
                        servilexPoolCode: bindingSlot?.piscinaCodigo || formData.servilexPoolCode,
                        servilexExtraConfig: formData.servilexEnabled
                            ? {
                                ...extraConfig,
                                cantidad: Number(extraConfig.cantidad) > 0 ? Number(extraConfig.cantidad) : 1,
                                horaInicio: bindingSlot?.horaInicio || manualSlot?.startTime || "",
                                horaFin: bindingSlot?.horaFin || manualSlot?.endTime || "",
                                duracion:
                                    bindingSlot?.duracionHoras && Number.isFinite(bindingSlot.duracionHoras)
                                        ? bindingSlot.duracionHoras
                                        : manualSlot?.duration || 1,
                            }
                            : {},
                    }),
                })
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                const { data } = await response.json()
                created.push(data)
            } catch (err) {
                const label = useBindingGeneration
                    ? buildPoolSlotNameFromBinding(slot as PoolGeneratorBinding)
                    : (slot as PoolGeneratedSlot).name
                errors.push(`${label}: ${err instanceof Error ? err.message : "Error"}`)
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

    const applyServilexPatch = (
        patch: Partial<{
            servilexSucursalCode: string
            servilexServiceCode: string
            servilexDisciplineCode: string
            servilexScheduleCode: string
            servilexPoolCode: string
            servilexBindingId: string | null
            capacity: number
            servilexExtraConfig: Record<string, unknown>
        }>
    ) => {
        setFormData((prev) => ({
            ...prev,
            ...patch,
            servilexServiceId: null,
        }))
        if (patch.capacity !== undefined) {
            setCapacityInput(String(patch.capacity))
        }
    }

    return (
        <Card>
            <CardHeader className="space-y-3">
                <div className="flex items-center justify-between">
                    <CardTitle>Entradas</CardTitle>
                    {inactiveCount > 0 && (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="text-xs text-gray-500"
                            onClick={() => setShowInactive(!showInactive)}
                        >
                            {showInactive
                                ? "Ocultar inactivos"
                                : `Mostrar ${inactiveCount} inactivo${inactiveCount > 1 ? "s" : ""}`}
                        </Button>
                    )}
                </div>
                {!isAdding && !editingId && !showPoolGenerator && (
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            onClick={startStandardTicket}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Entrada simple
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={startPerShiftTicket}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Entrada individual por turno
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={startFullDayTicket}
                        >
                            <Plus className="h-4 w-4 mr-2" />
                            Full day / paquete de dias
                        </Button>
                        {usesDailyCapacity && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                                setFormData((prev) => ({
                                    ...buildEmptyFormData(),
                                    servilexEnabled: true,
                                    servilexIndicator:
                                        prev.servilexIndicator === "PA" || prev.servilexIndicator === "PN"
                                            ? prev.servilexIndicator
                                            : "PN",
                                    servilexSucursalCode: prev.servilexSucursalCode || "01",
                                    servilexServiceCode: prev.servilexServiceCode || "",
                                    servilexPoolCode: prev.servilexPoolCode || "",
                                    servilexExtraConfig: {
                                        cantidad: getServilexExtraConfig(prev.servilexExtraConfig).cantidad || 1,
                                    },
                                }))
                                setShowPoolGenerator(true)
                            }}
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
                            {poolBindingMode
                                ? "Genera un horario por cada binding ABIO valido. La hora y la capacidad salen de la tabla de amarre; aqui solo defines el precio comercial."
                                : "Define el rango de horas y se creara una entrada por cada hora. Luego puedes ajustar la capacidad de cada horario individualmente."}
                        </p>
                        {poolBindingMode ? (
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                                <div className="rounded-md border border-dashed bg-white p-3 text-xs text-gray-600">
                                    {poolBindingsLoading
                                        ? "Cargando bindings ABIO de piscina libre..."
                                        : poolBindings.length > 0
                                            ? `Se detectaron ${poolBindings.length} combinaciones validas desde la tabla de amarre.`
                                            : "No hay bindings ABIO activos para este servicio y piscina. Debes sincronizar/importar antes de generar."}
                                </div>
                            </div>
                        ) : (
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
                        )}

                        <div className="space-y-4 rounded-md border bg-white p-4">
                            <div className="flex items-center gap-2">
                                <input
                                    id="poolServilexEnabled"
                                    type="checkbox"
                                    checked={Boolean(formData.servilexEnabled)}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            servilexEnabled: e.target.checked,
                                            servilexIndicator:
                                                prev.servilexIndicator === "PA" || prev.servilexIndicator === "PN"
                                                    ? prev.servilexIndicator
                                                    : "PN",
                                        }))
                                    }
                                    className="h-4 w-4 rounded border-gray-300"
                                    disabled={poolGenerating}
                                />
                                <label htmlFor="poolServilexEnabled" className="text-sm font-medium">
                                    Integrar automaticamente cada horario con Servilex / ABIO
                                </label>
                            </div>

                            {formData.servilexEnabled && (
                                <>
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium">Indicador ABIO</label>
                                            <select
                                                value={(formData.servilexIndicator || "PN").toUpperCase()}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        servilexIndicator: e.target.value,
                                                    }))
                                                }
                                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                disabled={poolGenerating}
                                            >
                                                <option value="PN">PN · Piscina no afiliado</option>
                                                <option value="PA">PA · Piscina afiliado</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium">Sucursal ABIO</label>
                                            <Input
                                                value={formData.servilexSucursalCode || ""}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        servilexSucursalCode: e.target.value,
                                                    }))
                                                }
                                                placeholder="01"
                                                disabled={poolGenerating}
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
                                                    }))
                                                }
                                                placeholder="403"
                                                disabled={poolGenerating}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium">Codigo piscina</label>
                                            <Input
                                                value={formData.servilexPoolCode || ""}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        servilexPoolCode: e.target.value,
                                                    }))
                                                }
                                                placeholder="01"
                                                disabled={poolGenerating}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                                        <div className="space-y-2">
                                            <label className="text-xs font-medium">Cantidad</label>
                                            <Input
                                                type="number"
                                                min={1}
                                                value={getServilexExtraConfig(formData.servilexExtraConfig).cantidad ?? 1}
                                                onChange={(e) => updateServilexExtraConfig("cantidad", e.target.value)}
                                                placeholder="1"
                                                disabled={poolGenerating}
                                            />
                                        </div>
                                        <div className="rounded-md border border-dashed bg-gray-50 p-3 text-xs text-gray-600 md:col-span-2">
                                            {poolBindingMode ? (
                                                <>
                                                    Cada horario generado heredara el <span className="font-medium">binding ABIO</span>,
                                                    la piscina, el horario y la capacidad real desde <span className="font-medium">numero_cupos</span>.
                                                </>
                                            ) : (
                                                <>
                                                    Cada horario generado heredara esta configuracion ABIO y completara automaticamente
                                                    <span className="font-medium"> hora inicio, hora fin y duracion </span>
                                                    segun la franja creada.
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {poolSlotsPreview && (
                            <div className="text-xs text-gray-600 space-y-1">
                                <p>
                                    <span className="font-medium">{poolSlotsPreview.newCount}</span> horarios por crear
                                    {poolSlotsPreview.skipCount > 0 && (
                                        <span className="text-amber-600"> ({poolSlotsPreview.skipCount} ya existen)</span>
                                    )}
                                </p>
                                {poolSlotsPreview.mode === "bindings" ? (
                                    <div className="grid gap-1 text-gray-500 sm:grid-cols-2">
                                        {poolSlotsPreview.rows.slice(0, 8).map((row) => (
                                            <div key={row.id}>{row.label}</div>
                                        ))}
                                        {poolSlotsPreview.rows.length > 8 && (
                                            <div className="text-gray-400">
                                                ... y {poolSlotsPreview.rows.length - 8} horario(s) mas
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-gray-400">
                                        {poolSlotsPreview.slots.join(", ")}
                                    </p>
                                )}
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
                                disabled={
                                    poolGenerating ||
                                    poolBindingsLoading ||
                                    !poolSlotsPreview ||
                                    poolSlotsPreview.newCount === 0
                                }
                            >
                                {poolGenerating
                                    ? "Generando..."
                                    : poolBindingMode
                                        ? `Generar ${poolSlotsPreview?.newCount ?? 0} horarios desde ABIO`
                                        : `Generar ${poolSlotsPreview?.newCount ?? 0} horarios`}
                            </Button>
                        </div>
                    </div>
                )}

                {(isAdding || editingId) && (
                    <div className="bg-gray-50 p-4 rounded-lg space-y-4 border">
                        <h4 className="font-medium text-sm">
                            {editingId
                                ? entryMode === "standard"
                                    ? "Editar entrada simple"
                                    : requireShiftSelection
                                        ? "Editar entrada individual por turno"
                                        : "Editar full day / paquete de dias"
                                : entryMode === "standard"
                                    ? "Nueva entrada simple"
                                    : requireShiftSelection
                                        ? "Nueva entrada individual por turno"
                                        : "Nuevo full day / paquete de dias"}
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
                                <label htmlFor="isPackage" className="text-sm">
                                    {scheduleMode === "full_day" ? "Paquete de varios dias" : "Paquete de selecciones dia + turno"}
                                </label>

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
                                {scheduleMode === "full_day"
                                    ? `Este ticket permitira registrar hasta ${formData.packageDaysCount || 0} dia(s) distintos del calendario que definas.`
                                    : `Este ticket permitira registrar hasta ${formData.packageDaysCount || 0} seleccion(es) de dia + turno.`}
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
                                    <AbioCatalogControls
                                        onCatalogChanged={() => setCatalogRefreshKey((prev) => prev + 1)}
                                    />

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
                                                        servilexBindingId: null,
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
                                                    setFormData({
                                                        ...formData,
                                                        servilexSucursalCode: e.target.value,
                                                        servilexBindingId: null,
                                                    })
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
                                                        servilexBindingId: null,
                                                    }))
                                                }
                                                placeholder="082"
                                            />
                                        </div>
                                    </div>

                                    <AbioBindingSelector
                                        key={catalogRefreshKey}
                                        indicator={currentServilexIndicator}
                                        sucursalCode={formData.servilexSucursalCode || ""}
                                        serviceCode={formData.servilexServiceCode || ""}
                                        disciplineCode={formData.servilexDisciplineCode || ""}
                                        scheduleCode={formData.servilexScheduleCode || ""}
                                        poolCode={formData.servilexPoolCode || ""}
                                        bindingId={formData.servilexBindingId || null}
                                        onPatch={applyServilexPatch}
                                    />

                                    <details className="rounded-md border border-dashed bg-gray-50 p-3 text-xs text-gray-600">
                                        <summary className="cursor-pointer font-medium text-gray-700">
                                            Fallback legado: catálogo local/manual
                                        </summary>
                                        <div className="mt-3 space-y-3">
                                            <ServilexServiceCombobox
                                                value={formData.servilexServiceId || null}
                                                onChange={(service) => {
                                                    if (service) {
                                                        setFormData({
                                                            ...formData,
                                                            servilexServiceId: service.id,
                                                            servilexIndicator: service.indicador,
                                                            servilexServiceCode: service.codigo,
                                                            servilexBindingId: null,
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
                                            <p>
                                                Usa este bloque solo si todavía no sincronizaste catálogo ABIO o necesitas rescatar una entrada antigua.
                                            </p>
                                        </div>
                                    </details>

                                    {currentServilexIndicator === "AC" && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Codigo disciplina</label>
                                                <Input
                                                    value={formData.servilexDisciplineCode || ""}
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            servilexDisciplineCode: e.target.value,
                                                            servilexBindingId: null,
                                                        })
                                                    }
                                                    placeholder="00"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Codigo horario</label>
                                                <Input
                                                    value={formData.servilexScheduleCode || ""}
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            servilexScheduleCode: e.target.value,
                                                            servilexBindingId: null,
                                                        })
                                                    }
                                                    placeholder="000001"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium">Codigo piscina</label>
                                                <Input
                                                    value={formData.servilexPoolCode || ""}
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            servilexPoolCode: e.target.value,
                                                            servilexBindingId: null,
                                                        })
                                                    }
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
                                                    onChange={(e) =>
                                                        setFormData({
                                                            ...formData,
                                                            servilexPoolCode: e.target.value,
                                                            servilexBindingId: null,
                                                        })
                                                    }
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

                                <div className="space-y-2">
                                    <div className="text-xs font-semibold text-gray-700">Modalidad de venta</div>
                                    <div className="grid gap-2 md:grid-cols-2">
                                        <button
                                            type="button"
                                            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                                                scheduleMode === "per_shift"
                                                    ? "border-blue-500 bg-blue-50 text-blue-900"
                                                    : "border-gray-200 bg-gray-50 text-gray-700"
                                            }`}
                                            onClick={() => setRequireShiftSelection(true)}
                                        >
                                            <div className="font-medium">Entrada individual por turno</div>
                                            <div className="text-xs text-gray-500">
                                                El comprador elige un dia y un turno especifico por cada entrada.
                                            </div>
                                        </button>
                                        <button
                                            type="button"
                                            className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                                                scheduleMode === "full_day"
                                                    ? "border-emerald-500 bg-emerald-50 text-emerald-900"
                                                    : "border-gray-200 bg-gray-50 text-gray-700"
                                            }`}
                                            onClick={() => setRequireShiftSelection(false)}
                                        >
                                            <div className="font-medium">Dia completo / paquete de dias</div>
                                            <div className="text-xs text-gray-500">
                                                El comprador elige dias. Cada dia incluye todos los turnos configurados.
                                            </div>
                                        </button>
                                    </div>
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

                                {shiftEntries.length > 0 && (
                                    <div className={`text-xs ${scheduleMode === "full_day" ? "text-blue-700" : "text-gray-600"}`}>
                                        {scheduleMode === "full_day"
                                            ? `Modo dia completo: con un solo QR del dia, el ticket sera valido para los ${configuredShiftCount} turno(s) configurados.`
                                            : "Modo por turno: cada entrada requerira seleccionar un turno especifico en checkout."}
                                    </div>
                                )}
                                {selectedValidDays.length > 0 && shiftEntries.length > 0 && formData.isPackage && (
                                    <div className="text-xs text-gray-600">
                                        {scheduleMode === "full_day"
                                            ? `Cobertura esperada: ${formData.packageDaysCount || 0} dia(s) x ${configuredShiftCount} turno(s) configurados por dia.`
                                            : `Cobertura esperada: ${formData.packageDaysCount || 0} seleccion(es) de dia + turno.`}
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
                    {
                        title: "Entradas simples",
                        description: "Entradas sin calendario ni turnos en checkout.",
                        items: standardTicketTypes,
                        empty: "No hay entradas simples registradas",
                    },
                    {
                        title: "Entradas individuales por turno",
                        description: "El comprador elige un dia especifico y un turno concreto por cada entrada.",
                        items: perShiftTicketTypes,
                        empty: "No hay entradas por turno registradas",
                    },
                    {
                        title: "Full day y paquetes de dias",
                        description: "El comprador elige dias del calendario. Cada dia incluye todos los turnos configurados.",
                        items: fullDayTicketTypes,
                        empty: "No hay full day o paquetes de dias registrados",
                    },
                ].map((section) => (
                    <div key={section.title} className="space-y-2">
                        <div className="space-y-1">
                            <h4 className="text-sm font-semibold text-gray-700">{section.title}</h4>
                            <p className="text-xs text-gray-500">{section.description}</p>
                        </div>
                        {section.items.map((ticket) => {
                            const schedule = parseTicketScheduleConfig(ticket.validDays)
                            const inventoryByDate = new Map(
                                (ticket.dateInventories ?? [])
                                    .map((inventory) => {
                                        const dateKey = toDateKeyUTC(inventory.date)
                                        return dateKey ? [dateKey, inventory] : null
                                    })
                                    .filter(Boolean) as Array<[string, NonNullable<TicketType["dateInventories"]>[number]]>
                            )

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
                                                        {schedule.dates.length} dias habilitados
                                                    </Badge>
                                                )}
                                                {schedule.shifts.length > 0 && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        {schedule.shifts.length} turnos por dia
                                                    </Badge>
                                                )}
                                                {schedule.shifts.length > 0 && schedule.requireShiftSelection && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        Seleccion individual
                                                    </Badge>
                                                )}
                                                {schedule.shifts.length > 0 && !schedule.requireShiftSelection && (
                                                    <Badge variant="secondary" className="text-xs">
                                                        Full day
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
                                                {formatPrice(ticket.price)} • {ticket.sold || 0} vendidos
                                                {usesDailyCapacity
                                                    ? ` totales · capacidad diaria ${ticket.capacity}`
                                                    : ` / ${ticket.capacity} vendidos`}
                                            </div>
                                            {schedule.dates.length > 0 && (
                                                <div className="mt-1 text-xs text-gray-500">
                                                    {schedule.requireShiftSelection
                                                        ? "Configurado para vender una entrada por turno en los dias habilitados."
                                                        : "Configurado para full day: cada dia seleccionado incluye todos los turnos activos."}
                                                </div>
                                            )}
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

                                    {usesDailyCapacity && dateOptions.length > 0 && (
                                        <div className="mt-4 space-y-2 rounded-md border border-dashed bg-gray-50 p-3">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="text-xs font-semibold text-gray-700">
                                                    Disponibilidad por fecha
                                                </div>
                                                <div className="text-[11px] text-gray-500">
                                                    Haz clic para habilitar o deshabilitar este horario por día
                                                </div>
                                            </div>
                                            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                                                {dateOptions.map((date) => {
                                                    const inventory = inventoryByDate.get(date)
                                                    const isEnabled = inventory?.isEnabled ?? true
                                                    const loadingKey = `${ticket.id}:${date}`

                                                    return (
                                                        <Button
                                                            key={`${ticket.id}-${date}`}
                                                            type="button"
                                                            size="sm"
                                                            variant={isEnabled ? "default" : "outline"}
                                                            className={isEnabled ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                                                            disabled={Boolean(dateToggleLoading[loadingKey])}
                                                            onClick={() =>
                                                                handleToggleDateAvailability(ticket.id!, date, !isEnabled)
                                                            }
                                                        >
                                                            {formatDate(date, { dateStyle: "medium" })}
                                                            <span className="ml-2 text-[10px] uppercase">
                                                                {dateToggleLoading[loadingKey]
                                                                    ? "..."
                                                                    : isEnabled
                                                                      ? "On"
                                                                      : "Off"}
                                                            </span>
                                                        </Button>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
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
