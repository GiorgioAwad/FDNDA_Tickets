"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Edit, Save, Power } from "lucide-react"
import { formatPrice } from "@/lib/utils"

interface TicketType {
    id?: string
    name: string
    price: number
    capacity: number
    sold?: number
    isActive?: boolean
    isPackage?: boolean
    packageDaysCount?: number
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
    const [loading, setLoading] = useState(false)

    const [autoName, setAutoName] = useState(true)
    const [daysLabel, setDaysLabel] = useState("L-M-V")
    const [sessionsPerWeek, setSessionsPerWeek] = useState(3)
    const [startTime, setStartTime] = useState("09:00")
    const [endTime, setEndTime] = useState("10:00")
    const [customLabel, setCustomLabel] = useState("")

    const [formData, setFormData] = useState<Partial<TicketType>>({
        name: "",
        price: 0,
        capacity: 100,
        isPackage: false,
        packageDaysCount: 0,
    })
    const [capacityInput, setCapacityInput] = useState("100")

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
        if (!autoName) return
        const generatedName = buildName()
        setFormData((prev) => ({ ...prev, name: generatedName }))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoName, daysLabel, sessionsPerWeek, startTime, endTime, customLabel, eventStartDate, eventEndDate])

    const resetForm = () => {
        setFormData({
            name: "",
            price: 0,
            capacity: 100,
            isPackage: false,
            packageDaysCount: 0,
        })
        setCapacityInput("100")
        setAutoName(true)
        setDaysLabel("L-M-V")
        setSessionsPerWeek(3)
        setStartTime("09:00")
        setEndTime("10:00")
        setCustomLabel("")
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

        setLoading(true)
        try {
            const url = "/api/ticket-types"
            const method = editingId ? "PUT" : "POST"
            const body = editingId
                ? { ...formData, id: editingId, capacity: capacityNumber }
                : { ...formData, eventId, capacity: capacityNumber }

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
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Tipos de Entrada</CardTitle>
                {!isAdding && !editingId && (
                    <Button size="sm" onClick={() => setIsAdding(true)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Agregar
                    </Button>
                )}
            </CardHeader>
            <CardContent className="space-y-4">
                {(isAdding || editingId) && (
                    <div className="bg-gray-50 p-4 rounded-lg space-y-4 border">
                        <h4 className="font-medium text-sm">
                            {editingId ? "Editar Entrada" : "Nueva Entrada"}
                        </h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Nombre</label>
                                <Input
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="Ej: General, VIP"
                                    readOnly={autoName}
                                />
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
                                <label htmlFor="isPackage" className="text-sm">Es Paquete</label>

                                {formData.isPackage && (
                                    <Input
                                        type="number"
                                        placeholder="Dias"
                                        className="w-20 h-8"
                                        value={formData.packageDaysCount || ""}
                                        onChange={(e) => setFormData({ ...formData, packageDaysCount: Number(e.target.value) })}
                                    />
                                )}
                            </div>
                        </div>

                        <div className="rounded-lg border bg-white p-3">
                            <div className="text-xs font-semibold text-gray-600 mb-3">
                                Constructor rapido de turno
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
                                    Activa "Nombre automatico" para generar el titulo del turno.
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={resetForm}>
                                Cancelar
                            </Button>
                            <Button size="sm" onClick={handleSave} loading={loading}>
                                <Save className="h-4 w-4 mr-2" />
                                Guardar
                            </Button>
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    {ticketTypes.map((ticket) => (
                        <div
                            key={ticket.id}
                            className={`flex items-center justify-between p-3 rounded-lg border ${ticket.isActive === false ? "bg-gray-100 opacity-60" : "bg-white"}`}
                        >
                            <div>
                                <div className="font-medium flex items-center gap-2">
                                    {ticket.name}
                                    {ticket.isPackage && (
                                        <Badge variant="secondary" className="text-xs">
                                            Paquete {ticket.packageDaysCount} dias
                                        </Badge>
                                    )}
                                    {ticket.isActive === false && (
                                        <Badge variant="destructive" className="text-xs">Inactivo</Badge>
                                    )}
                                </div>
                                <div className="text-sm text-gray-500">
                                    {formatPrice(ticket.price)} • {ticket.sold || 0} / {ticket.capacity} vendidos
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleToggleActive(ticket.id!, ticket.isActive !== false)}
                                    title={ticket.isActive !== false ? "Desactivar" : "Activar"}
                                >
                                    <Power className={`h-4 w-4 ${ticket.isActive !== false ? "text-green-500" : "text-gray-400"}`} />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        setEditingId(ticket.id!)
                                        setFormData(ticket)
                                        setAutoName(false)
                                        setIsAdding(false)
                                        setCapacityInput(String(ticket.capacity ?? 0))
                                    }}
                                >
                                    <Edit className="h-4 w-4 text-gray-500" />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => handleDelete(ticket.id!)}
                                >
                                    <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                            </div>
                        </div>
                    ))}
                    {ticketTypes.length === 0 && !isAdding && (
                        <div className="text-center py-4 text-gray-500 text-sm">
                            No hay tipos de entrada registrados
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
