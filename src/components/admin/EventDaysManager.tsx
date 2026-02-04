"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Plus, Save, Trash2, Edit } from "lucide-react"

type EventDay = {
    id?: string
    date: string
    openTime: string
    closeTime: string
    capacity: number
}

interface EventDaysManagerProps {
    eventId: string
    initialDays: EventDay[]
    eventStartDate?: string | Date
    eventEndDate?: string | Date
}

const formatDateInputValue = (value: string) => {
    if (!value) return ""
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ""
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, "0")
    const day = String(date.getUTCDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

export function EventDaysManager({
    eventId,
    initialDays,
    eventStartDate,
    eventEndDate,
}: EventDaysManagerProps) {
    const [days, setDays] = useState<EventDay[]>(
        initialDays.map((day) => ({
            ...day,
            date: formatDateInputValue(day.date),
        }))
    )
    const [isAdding, setIsAdding] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState<EventDay>({
        date: "",
        openTime: "09:00",
        closeTime: "10:00",
        capacity: 0,
    })

    const minDate = useMemo(() => formatDateInputValue(String(eventStartDate ?? "")), [eventStartDate])
    const maxDate = useMemo(() => formatDateInputValue(String(eventEndDate ?? "")), [eventEndDate])

    const resetForm = () => {
        setFormData({
            date: "",
            openTime: "09:00",
            closeTime: "10:00",
            capacity: 0,
        })
        setIsAdding(false)
        setEditingId(null)
    }

    const handleSave = async () => {
        if (!formData.date || !formData.openTime || !formData.closeTime) return

        setLoading(true)
        try {
            const method = editingId ? "PUT" : "POST"
            const body = editingId
                ? { ...formData, id: editingId }
                : { ...formData, eventId }

            const response = await fetch("/api/event-days", {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Error al guardar día")

            if (editingId) {
                setDays(days.map((day) => (day.id === editingId ? data.data : day)))
            } else {
                setDays([...days, data.data])
            }

            resetForm()
        } catch (error) {
            console.error(error)
            alert(error instanceof Error ? error.message : "Error al guardar día")
        } finally {
            setLoading(false)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm("¿Eliminar este día?")) return

        try {
            const response = await fetch(`/api/event-days?id=${id}`, { method: "DELETE" })
            const data = await response.json()
            if (!response.ok) throw new Error(data.error || "Error al eliminar día")
            setDays(days.filter((day) => day.id !== id))
        } catch (error) {
            console.error(error)
            alert(error instanceof Error ? error.message : "Error al eliminar día")
        }
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Días del Evento</CardTitle>
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
                        <div className="text-sm font-medium">
                            {editingId ? "Editar día" : "Nuevo día"}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Fecha</label>
                                <Input
                                    type="date"
                                    min={minDate || undefined}
                                    max={maxDate || undefined}
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Capacidad</label>
                                <Input
                                    type="number"
                                    min={0}
                                    value={formData.capacity}
                                    onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Hora inicio</label>
                                <Input
                                    type="time"
                                    value={formData.openTime}
                                    onChange={(e) => setFormData({ ...formData, openTime: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-medium">Hora fin</label>
                                <Input
                                    type="time"
                                    value={formData.closeTime}
                                    onChange={(e) => setFormData({ ...formData, closeTime: e.target.value })}
                                />
                            </div>
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
                    {days.map((day) => (
                        <div
                            key={day.id}
                            className="flex items-center justify-between p-3 rounded-lg border bg-white"
                        >
                            <div>
                                <div className="font-medium">{day.date}</div>
                                <div className="text-sm text-gray-500">
                                    {day.openTime} - {day.closeTime} · Capacidad {day.capacity}
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                        setEditingId(day.id ?? null)
                                        setFormData(day)
                                        setIsAdding(false)
                                    }}
                                >
                                    <Edit className="h-4 w-4 text-gray-500" />
                                </Button>
                                {day.id && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDelete(day.id!)}
                                    >
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                    {days.length === 0 && !isAdding && (
                        <div className="text-center py-4 text-gray-500 text-sm">
                            No hay días registrados todavía.
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}


