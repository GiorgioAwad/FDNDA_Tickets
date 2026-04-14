"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ImageUploader } from "@/components/ui/image-uploader"
import { Save, ArrowLeft } from "lucide-react"
import { TicketTypeManager } from "@/components/admin/TicketTypeManager"
import { EventDaysManager } from "@/components/admin/EventDaysManager"
import type { EventWithDetails, EventWithDetailsSerialized } from "@/types"
import { formatDateInput } from "@/lib/utils"

interface EventFormProps {
    initialData?: EventWithDetails | EventWithDetailsSerialized
    isEditing?: boolean
    showBack?: boolean
}

interface EventFormData {
    title: string
    description: string
    location: string
    venue: string
    discipline: string
    category: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
    advanceAmount: string
    startDate: string
    endDate: string
    mode: "RANGE" | "DAYS"
    isPublished: boolean
    bannerUrl: string
}

export function EventForm({ initialData, isEditing = false, showBack = true }: EventFormProps) {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    const [formData, setFormData] = useState<EventFormData>({
        title: initialData?.title || "",
        description: initialData?.description || "",
        location: initialData?.location || "",
        venue: initialData?.venue || "",
        discipline: initialData?.discipline || "",
        category: initialData?.category || "EVENTO",
        advanceAmount: initialData?.advanceAmount ? String(initialData.advanceAmount) : "0",
        startDate: initialData?.startDate ? formatDateInput(initialData.startDate) : "",
        endDate: initialData?.endDate ? formatDateInput(initialData.endDate) : "",
        mode: initialData?.mode || "RANGE",
        isPublished: initialData?.isPublished || false,
        bannerUrl: initialData?.bannerUrl || "",
    })

    const ticketTypes = initialData?.ticketTypes.map((ticket) => ({
        ...ticket,
        price: Number(ticket.price),
        packageDaysCount: ticket.packageDaysCount ?? undefined,
    })) || []

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value
        setFormData({ ...formData, [e.target.name]: value })
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError("")

        try {
            const eventId = initialData?.id

            if (isEditing && !eventId) {
                setError("No se pudo determinar el evento a editar.")
                return
            }

            const url = isEditing ? `/api/events/${eventId!}` : "/api/events"
            const method = isEditing ? "PUT" : "POST"

            const response = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || "Error al guardar evento")
            }

            // If creating, we get the ID to add ticket types/days
            // The event is created/updated at this point. Ticket types are managed separately.
            router.push("/admin/eventos")
            router.refresh()
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Header con navegación */}
            {showBack && (
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => router.back()}
                    className="mb-2"
                >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Volver
                </Button>
            )}

            {/* Título y acciones */}
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">
                    {isEditing ? "Editar Evento" : "Nuevo Evento"}
                </h1>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isPublished"
                            name="isPublished"
                            checked={formData.isPublished}
                            onChange={(e) => setFormData({ ...formData, isPublished: e.target.checked })}
                            className="h-4 w-4 rounded border-gray-300"
                        />
                        <label htmlFor="isPublished" className="text-sm font-medium">
                            Publicado
                        </label>
                    </div>
                    <Button type="submit" loading={loading}>
                        <Save className="h-4 w-4 mr-2" />
                        Guardar
                    </Button>
                </div>
            </div>

            {error && (
                <div className="bg-red-50 text-red-600 p-4 rounded-lg">
                    {error}
                </div>
            )}

            {/* Event details + Banner */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Información General</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Título del Evento</label>
                                <Input
                                    name="title"
                                    value={formData.title}
                                    onChange={handleChange}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Descripción</label>
                                <textarea
                                    name="description"
                                    value={formData.description}
                                    onChange={handleChange}
                                    className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Disciplina</label>
                                    <select
                                        name="discipline"
                                        value={formData.discipline}
                                        onChange={handleChange}
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    >
                                        <option value="">Seleccionar...</option>
                                        <option value="Natación">Natación</option>
                                        <option value="Waterpolo">Waterpolo</option>
                                        <option value="Clavados">Clavados</option>
                                        <option value="Natación Artística">Natación Artística</option>
                                        <option value="Aguas Abiertas">Aguas Abiertas</option>
                                        <option value="Master">Master</option>
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Tipo de evento</label>
                                    <select
                                        name="category"
                                        value={formData.category}
                                        onChange={handleChange}
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        required
                                    >
                                        <option value="EVENTO">Evento</option>
                                        <option value="PISCINA_LIBRE">Piscina libre</option>
                                        <option value="ACADEMIA">Academia</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Adelanto aplicado</label>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        name="advanceAmount"
                                        value={formData.advanceAmount}
                                        onChange={handleChange}
                                    />
                                    <p className="text-xs text-gray-500">
                                        Si no aplica adelanto, deja el valor en 0.00.
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Modo de Fechas</label>
                                    <select
                                        name="mode"
                                        value={formData.mode}
                                        onChange={handleChange}
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    >
                                        <option value="RANGE">Rango de Fechas</option>
                                        <option value="DAYS">Días Específicos</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Sede (Venue)</label>
                                    <Input
                                        name="venue"
                                        placeholder="Ej: Campo de Marte"
                                        value={formData.venue}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Ciudad/Ubicación</label>
                                    <Input
                                        name="location"
                                        placeholder="Ej: Lima, Perú"
                                        value={formData.location}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Fecha Inicio</label>
                                    <Input
                                        type="date"
                                        name="startDate"
                                        value={formData.startDate}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Fecha Fin</label>
                                    <Input
                                        type="date"
                                        name="endDate"
                                        value={formData.endDate}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Banner del Evento</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ImageUploader
                                value={formData.bannerUrl}
                                onChange={(url) => setFormData({ ...formData, bannerUrl: url })}
                                type="banner"
                                label="Imagen del Banner"
                                showUrlInput={true}
                            />
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Ticket Types & Days - full width */}
            {isEditing && initialData?.id && (
                <div className="space-y-6">
                    <TicketTypeManager
                        eventId={initialData.id}
                        initialTicketTypes={ticketTypes}
                        eventCategory={formData.category}
                        eventStartDate={formData.startDate || initialData.startDate}
                        eventEndDate={formData.endDate || initialData.endDate}
                    />

                    <EventDaysManager
                        eventId={initialData.id}
                        initialDays={initialData.eventDays.map((day) => ({
                            id: day.id,
                            date: typeof day.date === "string" ? day.date : new Date(day.date).toISOString(),
                            openTime: day.openTime,
                            closeTime: day.closeTime,
                            capacity: day.capacity,
                        }))}
                        eventStartDate={formData.startDate || initialData.startDate}
                        eventEndDate={formData.endDate || initialData.endDate}
                    />
                </div>
            )}

            {!isEditing && (
                <Card>
                    <CardHeader>
                        <CardTitle>Gestión Avanzada</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        <p className="text-sm text-gray-500">
                            Para gestionar tipos de entradas y días específicos, guarda primero el evento.
                        </p>
                    </CardContent>
                </Card>
            )}
        </form>
    )
}


