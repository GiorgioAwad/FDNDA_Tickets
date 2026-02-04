"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Gift, Copy, CheckCircle, Clock, History, Ticket, Percent, Tag, Plus, Trash2, Edit2, X, Eye, User, Mail, Calendar, QrCode, AlertCircle } from "lucide-react"

type TicketTypeSummary = {
    id: string
    name: string
}

type EventWithTicketTypes = {
    id: string
    title: string
    ticketTypes: TicketTypeSummary[]
}

type CourtesyTicketSummary = {
    id: string
    claimCode: string
    assignedName: string | null
    assignedDni: string | null
}

type CourtesyBatchListItem = {
    id: string
    reason: string | null
    quantity: number
    createdAt: string | Date
    event: { title: string }
    ticketType: { name: string }
}

type CourtesyTicketDetail = {
    id: string
    claimCode: string
    status: "PENDING" | "CLAIMED" | "EXPIRED"
    assignedName: string | null
    assignedDni: string | null
    claimedAt: string | null
    expiresAt: string | null
    claimedByUser: { name: string | null; email: string } | null
    generatedTicket: {
        id: string
        attendeeName: string | null
        attendeeDni: string | null
        status: string
        scans: Array<{
            scannedAt: string
            eventDay: { name: string } | null
        }>
    } | null
}

type BatchDetail = {
    id: string
    reason: string | null
    quantity: number
    createdAt: string
    event: { id: string; title: string; slug: string }
    ticketType: { id: string; name: string; price: number }
    createdByUser: { name: string | null; email: string } | null
    courtesyTickets: CourtesyTicketDetail[]
}

type DiscountCode = {
    id: string
    code: string
    description: string | null
    type: "PERCENTAGE" | "FIXED"
    value: number
    eventId: string | null
    event: { id: string; title: string } | null
    minPurchase: number | null
    maxUses: number | null
    maxUsesPerUser: number
    validFrom: string
    validUntil: string | null
    isActive: boolean
    createdAt: string
    _count: { usages: number }
}

export default function CourtesyPage() {
    const [activeTab, setActiveTab] = useState<"cortesias" | "descuentos">("cortesias")
    const [events, setEvents] = useState<EventWithTicketTypes[]>([])
    const [batches, setBatches] = useState<CourtesyBatchListItem[]>([])
    const [loading, setLoading] = useState(false)
    const [generatedCodes, setGeneratedCodes] = useState<CourtesyTicketSummary[]>([])
    const [copiedId, setCopiedId] = useState<string | null>(null)

    // Batch detail modal state
    const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null)
    const [loadingDetail, setLoadingDetail] = useState(false)

    // Discount codes state
    const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([])
    const [showDiscountForm, setShowDiscountForm] = useState(false)
    const [editingDiscount, setEditingDiscount] = useState<DiscountCode | null>(null)
    const [discountForm, setDiscountForm] = useState({
        code: "",
        description: "",
        type: "PERCENTAGE" as "PERCENTAGE" | "FIXED",
        value: 10,
        eventId: "",
        minPurchase: "",
        maxUses: "",
        maxUsesPerUser: 1,
        validFrom: "",
        validUntil: "",
    })

    const [formData, setFormData] = useState({
        eventId: "",
        ticketTypeId: "",
        quantity: 1,
        reason: "",
    })
    
    // Estado para entradas asignadas
    const [useAssignedAttendees, setUseAssignedAttendees] = useState(false)
    const [assignedAttendees, setAssignedAttendees] = useState<Array<{ name: string; dni: string }>>([])

    useEffect(() => {
        // Load events and batches
        fetch("/api/events?admin=true")
            .then(res => res.json() as Promise<{ data?: EventWithTicketTypes[] }>)
            .then(d => setEvents(d.data || []))
        fetch("/api/admin/courtesy")
            .then(res => res.json() as Promise<{ data?: CourtesyBatchListItem[] }>)
            .then(d => setBatches(d.data || []))
        fetch("/api/admin/discounts")
            .then(res => res.json() as Promise<{ data?: DiscountCode[] }>)
            .then(d => setDiscountCodes(d.data || []))
    }, [])

    const selectedEvent = events.find(e => e.id === formData.eventId)

    const copyToClipboard = async (code: string, id: string) => {
        await navigator.clipboard.writeText(code)
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const copyAllCodes = async () => {
        const allCodes = generatedCodes.map(c => c.claimCode).join("\n")
        await navigator.clipboard.writeText(allCodes)
        setCopiedId("all")
        setTimeout(() => setCopiedId(null), 2000)
    }

    const loadBatchDetail = async (batchId: string) => {
        setLoadingDetail(true)
        try {
            const res = await fetch(`/api/admin/courtesy/${batchId}`)
            const data = await res.json()
            if (data.success) {
                setBatchDetail(data.data)
            }
        } catch (err) {
            console.error("Error loading batch detail:", err)
        } finally {
            setLoadingDetail(false)
        }
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "CLAIMED":
                return <Badge className="bg-green-100 text-green-700 hover:bg-green-100">Canjeado</Badge>
            case "EXPIRED":
                return <Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100">Expirado</Badge>
            default:
                return <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100">Pendiente</Badge>
        }
    }

    const resetDiscountForm = () => {
        setDiscountForm({
            code: "",
            description: "",
            type: "PERCENTAGE",
            value: 10,
            eventId: "",
            minPurchase: "",
            maxUses: "",
            maxUsesPerUser: 1,
            validFrom: "",
            validUntil: "",
        })
        setEditingDiscount(null)
        setShowDiscountForm(false)
    }

    const handleDiscountSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const payload = {
                code: discountForm.code,
                description: discountForm.description || null,
                type: discountForm.type,
                value: discountForm.value,
                eventId: discountForm.eventId || null,
                minPurchase: discountForm.minPurchase ? parseFloat(discountForm.minPurchase) : null,
                maxUses: discountForm.maxUses ? parseInt(discountForm.maxUses) : null,
                maxUsesPerUser: discountForm.maxUsesPerUser,
                validFrom: discountForm.validFrom || null,
                validUntil: discountForm.validUntil || null,
            }

            const url = editingDiscount 
                ? `/api/admin/discounts/${editingDiscount.id}`
                : "/api/admin/discounts"
            const method = editingDiscount ? "PUT" : "POST"

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await res.json()
            if (data.success) {
                resetDiscountForm()
                // Refresh discount codes
                fetch("/api/admin/discounts")
                    .then(res => res.json() as Promise<{ data?: DiscountCode[] }>)
                    .then(d => setDiscountCodes(d.data || []))
            } else {
                alert(data.error || "Error al guardar código")
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const handleEditDiscount = (discount: DiscountCode) => {
        setEditingDiscount(discount)
        setDiscountForm({
            code: discount.code,
            description: discount.description || "",
            type: discount.type,
            value: discount.value,
            eventId: discount.eventId || "",
            minPurchase: discount.minPurchase?.toString() || "",
            maxUses: discount.maxUses?.toString() || "",
            maxUsesPerUser: discount.maxUsesPerUser,
            validFrom: discount.validFrom ? discount.validFrom.split("T")[0] : "",
            validUntil: discount.validUntil ? discount.validUntil.split("T")[0] : "",
        })
        setShowDiscountForm(true)
    }

    const handleDeleteDiscount = async (id: string) => {
        if (!confirm("¿Eliminar este código de descuento?")) return
        try {
            const res = await fetch(`/api/admin/discounts/${id}`, { method: "DELETE" })
            const data = await res.json()
            if (data.success) {
                fetch("/api/admin/discounts")
                    .then(res => res.json() as Promise<{ data?: DiscountCode[] }>)
                    .then(d => setDiscountCodes(d.data || []))
            }
        } catch (err) {
            console.error(err)
        }
    }

    const copyDiscountCode = async (code: string) => {
        await navigator.clipboard.writeText(code)
        setCopiedId(code)
        setTimeout(() => setCopiedId(null), 2000)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const payload = {
                ...formData,
                assignedAttendees: useAssignedAttendees ? assignedAttendees : undefined,
            }
            const res = await fetch("/api/admin/courtesy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await res.json()
            if (data.success) {
                setGeneratedCodes(data.data.tickets)
                setFormData({ eventId: "", ticketTypeId: "", quantity: 1, reason: "" })
                setUseAssignedAttendees(false)
                setAssignedAttendees([])
                // Refresh batches
                fetch("/api/admin/courtesy")
                    .then(res => res.json() as Promise<{ data?: CourtesyBatchListItem[] }>)
                    .then(d => setBatches(d.data || []))
            }
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }
    
    // Función para actualizar los asistentes asignados cuando cambia la cantidad
    const updateAssignedAttendeesCount = (newQuantity: number) => {
        setFormData({ ...formData, quantity: newQuantity })
        if (useAssignedAttendees) {
            const current = [...assignedAttendees]
            if (newQuantity > current.length) {
                // Agregar filas vacías
                for (let i = current.length; i < newQuantity; i++) {
                    current.push({ name: "", dni: "" })
                }
            } else {
                // Recortar
                current.length = newQuantity
            }
            setAssignedAttendees(current)
        }
    }
    
    const toggleUseAssignedAttendees = (checked: boolean) => {
        setUseAssignedAttendees(checked)
        if (checked) {
            // Inicializar array con la cantidad actual
            const initial = Array.from({ length: formData.quantity }, () => ({ name: "", dni: "" }))
            setAssignedAttendees(initial)
        } else {
            setAssignedAttendees([])
        }
    }
    
    const updateAssignedAttendee = (index: number, field: "name" | "dni", value: string) => {
        const updated = [...assignedAttendees]
        updated[index] = { ...updated[index], [field]: value }
        setAssignedAttendees(updated)
    }

    // Stats
    const totalCourtesies = batches.reduce((acc, b) => acc + b.quantity, 0)
    const activeDiscounts = discountCodes.filter(d => d.isActive).length

    return (
        <div className="space-y-6">
            {/* Tabs */}
            <div className="flex gap-2 border-b">
                <button
                    className={`px-4 py-2 font-medium transition-colors ${
                        activeTab === "cortesias"
                            ? "border-b-2 border-purple-600 text-purple-600"
                            : "text-gray-500 hover:text-gray-700"
                    }`}
                    onClick={() => setActiveTab("cortesias")}
                >
                    <Gift className="h-4 w-4 inline mr-2" />
                    Entradas Gratis
                </button>
                <button
                    className={`px-4 py-2 font-medium transition-colors ${
                        activeTab === "descuentos"
                            ? "border-b-2 border-blue-600 text-blue-600"
                            : "text-gray-500 hover:text-gray-700"
                    }`}
                    onClick={() => setActiveTab("descuentos")}
                >
                    <Percent className="h-4 w-4 inline mr-2" />
                    Códigos de Descuento
                </button>
            </div>

            {activeTab === "cortesias" ? (
                <>
                    {/* Stats */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-purple-100">
                                        <Gift className="h-5 w-5 text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{totalCourtesies}</p>
                                        <p className="text-xs text-gray-500">Total Cortesías</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-blue-100">
                                        <History className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{batches.length}</p>
                                        <p className="text-xs text-gray-500">Lotes Generados</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-green-100">
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{generatedCodes.length}</p>
                                        <p className="text-xs text-gray-500">Recién Generados</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-orange-100">
                                        <Ticket className="h-5 w-5 text-orange-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{events.length}</p>
                                        <p className="text-xs text-gray-500">Eventos Activos</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Generator Form */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Gift className="h-5 w-5 text-purple-600" />
                            Generar Cortesías
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Evento</label>
                                <select
                                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={formData.eventId}
                                    onChange={(e) => setFormData({ ...formData, eventId: e.target.value, ticketTypeId: "" })}
                                    required
                                >
                                    <option value="">Seleccionar evento...</option>
                                    {events.map(e => (
                                        <option key={e.id} value={e.id}>{e.title}</option>
                                    ))}
                                </select>
                            </div>

                            {selectedEvent && (
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Tipo de Entrada</label>
                                    <select
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        value={formData.ticketTypeId}
                                        onChange={(e) => setFormData({ ...formData, ticketTypeId: e.target.value })}
                                        required
                                    >
                                        <option value="">Seleccionar entrada...</option>
                                        {selectedEvent.ticketTypes.map((t) => (
                                            <option key={t.id} value={t.id}>{t.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Cantidad</label>
                                    <Input
                                        type="number"
                                        min="1"
                                        max="50"
                                        value={formData.quantity}
                                        onChange={(e) => updateAssignedAttendeesCount(Number(e.target.value))}
                                        required
                                    />
                                </div>
                                <div className="flex items-end">
                                    <p className="text-xs text-gray-500 mb-2">Máximo 50 por lote</p>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Motivo / Beneficiario</label>
                                <Input
                                    placeholder="Ej: Auspiciadores, Sorteo Redes Sociales"
                                    value={formData.reason}
                                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                                    required
                                />
                            </div>
                            
                            {/* Opción de Entradas Asignadas */}
                            <div className="space-y-4 border-t pt-4">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={useAssignedAttendees}
                                        onChange={(e) => toggleUseAssignedAttendees(e.target.checked)}
                                        className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                                    />
                                    <span className="text-sm font-medium">Entradas con asistente asignado</span>
                                </label>
                                <p className="text-xs text-gray-500 -mt-2">
                                    Activa esta opción para pre-asignar nombre y DNI a cada entrada. El beneficiario no podrá modificar estos datos al canjear.
                                </p>
                                
                                {useAssignedAttendees && (
                                    <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
                                        <p className="text-sm font-medium text-gray-700">Datos de los asistentes:</p>
                                        {assignedAttendees.map((attendee, index) => (
                                            <div key={index} className="grid grid-cols-2 gap-2">
                                                <Input
                                                    placeholder={`Nombre entrada #${index + 1}`}
                                                    value={attendee.name}
                                                    onChange={(e) => updateAssignedAttendee(index, "name", e.target.value)}
                                                    className="text-sm"
                                                />
                                                <Input
                                                    placeholder={`DNI entrada #${index + 1}`}
                                                    value={attendee.dni}
                                                    onChange={(e) => updateAssignedAttendee(index, "dni", e.target.value)}
                                                    className="text-sm"
                                                />
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <Button type="submit" className="w-full gap-2" disabled={loading}>
                                {loading ? (
                                    <>
                                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                        Generando...
                                    </>
                                ) : (
                                    <>
                                        <Gift className="h-4 w-4" />
                                        Generar Códigos
                                    </>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>

                <div className="space-y-6">
                    {/* Generated Codes */}
                    {generatedCodes.length > 0 && (
                        <Card className="bg-green-50 border-green-200">
                            <CardHeader className="pb-2">
                                <div className="flex items-center justify-between">
                                    <CardTitle className="text-green-800 flex items-center gap-2">
                                        <CheckCircle className="h-5 w-5" />
                                        Códigos Generados
                                    </CardTitle>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={copyAllCodes}
                                        className="gap-2"
                                    >
                                        {copiedId === "all" ? (
                                            <>
                                                <CheckCircle className="h-3 w-3 text-green-600" />
                                                Copiados!
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="h-3 w-3" />
                                                Copiar Todos
                                            </>
                                        )}
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="bg-white p-3 rounded-lg border space-y-2 max-h-48 overflow-y-auto">
                                    {generatedCodes.map((code) => (
                                        <div key={code.id} className="flex justify-between items-center group hover:bg-gray-50 rounded px-2 py-1 -mx-2">
                                            <div className="flex flex-col">
                                                <span className="font-mono text-sm">{code.claimCode}</span>
                                                {code.assignedName && (
                                                    <span className="text-xs text-gray-500">
                                                        → {code.assignedName} {code.assignedDni ? `(${code.assignedDni})` : ""}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {code.assignedName ? (
                                                    <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                                                        Asignada
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
                                                        <Clock className="h-3 w-3 mr-1" />
                                                        Pendiente
                                                    </Badge>
                                                )}
                                                <button
                                                    onClick={() => copyToClipboard(code.claimCode, code.id)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-gray-100 rounded"
                                                >
                                                    {copiedId === code.id ? (
                                                        <CheckCircle className="h-4 w-4 text-green-600" />
                                                    ) : (
                                                        <Copy className="h-4 w-4 text-gray-400" />
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <p className="text-xs text-green-700 mt-3">
                                    💡 Comparte estos códigos con los beneficiarios para que los canjeen en la página del evento.
                                </p>
                            </CardContent>
                        </Card>
                    )}

                    {/* History */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="h-5 w-5 text-gray-500" />
                                Historial de Lotes
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3 max-h-96 overflow-y-auto">
                                {batches.map((batch) => (
                                    <div 
                                        key={batch.id} 
                                        className="flex justify-between items-start border-b pb-3 last:border-0 last:pb-0 hover:bg-gray-50 p-2 -mx-2 rounded-lg cursor-pointer transition-colors"
                                        onClick={() => loadBatchDetail(batch.id)}
                                    >
                                        <div className="space-y-1">
                                            <div className="font-medium text-gray-900 flex items-center gap-2">
                                                {batch.reason}
                                                <Eye className="h-3.5 w-3.5 text-gray-400" />
                                            </div>
                                            <div className="text-sm text-gray-600 flex items-center gap-2">
                                                <Badge variant="secondary" className="font-normal">
                                                    {batch.quantity} entradas
                                                </Badge>
                                                <span>·</span>
                                                <span>{batch.ticketType.name}</span>
                                            </div>
                                            <div className="text-xs text-gray-400">
                                                {batch.event.title}
                                            </div>
                                        </div>
                                        <div className="text-right text-xs text-gray-500 whitespace-nowrap">
                                            {new Date(batch.createdAt).toLocaleDateString("es-PE", {
                                                day: "2-digit",
                                                month: "short",
                                                year: "numeric"
                                            })}
                                        </div>
                                    </div>
                                ))}
                                {batches.length === 0 && (
                                    <div className="text-center py-8 text-gray-500">
                                        <Gift className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                                        <p>No hay historial de cortesías</p>
                                        <p className="text-xs text-gray-400 mt-1">Los lotes generados aparecerán aquí</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
                </>
            ) : (
                /* Discount Codes Tab */
                <>
                    {/* Stats */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-blue-100">
                                        <Percent className="h-5 w-5 text-blue-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{discountCodes.length}</p>
                                        <p className="text-xs text-gray-500">Total Códigos</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-green-100">
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{activeDiscounts}</p>
                                        <p className="text-xs text-gray-500">Activos</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-purple-100">
                                        <Tag className="h-5 w-5 text-purple-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">
                                            {discountCodes.reduce((acc, d) => acc + d._count.usages, 0)}
                                        </p>
                                        <p className="text-xs text-gray-500">Usos Totales</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardContent className="p-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-orange-100">
                                        <Ticket className="h-5 w-5 text-orange-600" />
                                    </div>
                                    <div>
                                        <p className="text-2xl font-bold">{events.length}</p>
                                        <p className="text-xs text-gray-500">Eventos Activos</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Create/Edit Form */}
                    {showDiscountForm ? (
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    {editingDiscount ? (
                                        <><Edit2 className="h-5 w-5 text-blue-600" /> Editar Código</>
                                    ) : (
                                        <><Plus className="h-5 w-5 text-blue-600" /> Nuevo Código de Descuento</>
                                    )}
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleDiscountSubmit} className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Código</label>
                                            <Input
                                                placeholder="Ej: FDNDA20, PROMO50"
                                                value={discountForm.code}
                                                onChange={(e) => setDiscountForm({ ...discountForm, code: e.target.value.toUpperCase() })}
                                                required
                                                className="uppercase"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Descripción (opcional)</label>
                                            <Input
                                                placeholder="Ej: Promo lanzamiento"
                                                value={discountForm.description}
                                                onChange={(e) => setDiscountForm({ ...discountForm, description: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Tipo de Descuento</label>
                                            <select
                                                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                value={discountForm.type}
                                                onChange={(e) => setDiscountForm({ ...discountForm, type: e.target.value as "PERCENTAGE" | "FIXED" })}
                                            >
                                                <option value="PERCENTAGE">Porcentaje (%)</option>
                                                <option value="FIXED">Monto Fijo (S/)</option>
                                            </select>
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">
                                                Valor {discountForm.type === "PERCENTAGE" ? "(%)" : "(S/)"}
                                            </label>
                                            <Input
                                                type="number"
                                                min="0"
                                                max={discountForm.type === "PERCENTAGE" ? 100 : undefined}
                                                step={discountForm.type === "PERCENTAGE" ? 1 : 0.01}
                                                value={discountForm.value}
                                                onChange={(e) => setDiscountForm({ ...discountForm, value: parseFloat(e.target.value) || 0 })}
                                                required
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Evento (opcional)</label>
                                            <select
                                                className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                value={discountForm.eventId}
                                                onChange={(e) => setDiscountForm({ ...discountForm, eventId: e.target.value })}
                                            >
                                                <option value="">Todos los eventos</option>
                                                {events.map(e => (
                                                    <option key={e.id} value={e.id}>{e.title}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Compra Mínima</label>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                placeholder="S/ 0.00"
                                                value={discountForm.minPurchase}
                                                onChange={(e) => setDiscountForm({ ...discountForm, minPurchase: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Usos Máximos</label>
                                            <Input
                                                type="number"
                                                min="1"
                                                placeholder="Ilimitado"
                                                value={discountForm.maxUses}
                                                onChange={(e) => setDiscountForm({ ...discountForm, maxUses: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Usos por Usuario</label>
                                            <Input
                                                type="number"
                                                min="1"
                                                value={discountForm.maxUsesPerUser}
                                                onChange={(e) => setDiscountForm({ ...discountForm, maxUsesPerUser: parseInt(e.target.value) || 1 })}
                                            />
                                        </div>
                                        <div></div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Válido Desde</label>
                                            <Input
                                                type="date"
                                                value={discountForm.validFrom}
                                                onChange={(e) => setDiscountForm({ ...discountForm, validFrom: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Válido Hasta (opcional)</label>
                                            <Input
                                                type="date"
                                                value={discountForm.validUntil}
                                                onChange={(e) => setDiscountForm({ ...discountForm, validUntil: e.target.value })}
                                            />
                                        </div>
                                    </div>

                                    <div className="flex gap-2 pt-4">
                                        <Button type="submit" disabled={loading}>
                                            {loading ? "Guardando..." : editingDiscount ? "Actualizar Código" : "Crear Código"}
                                        </Button>
                                        <Button type="button" variant="outline" onClick={resetDiscountForm}>
                                            Cancelar
                                        </Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>
                    ) : (
                        <Button onClick={() => setShowDiscountForm(true)} className="gap-2">
                            <Plus className="h-4 w-4" />
                            Nuevo Código de Descuento
                        </Button>
                    )}

                    {/* Discount Codes List */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Tag className="h-5 w-5 text-blue-600" />
                                Códigos de Descuento
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-3">
                                {discountCodes.map((discount) => (
                                    <div 
                                        key={discount.id} 
                                        className={`flex justify-between items-start p-4 rounded-lg border ${
                                            discount.isActive ? "bg-white" : "bg-gray-50 opacity-60"
                                        }`}
                                    >
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono font-bold text-lg">{discount.code}</span>
                                                <button
                                                    onClick={() => copyDiscountCode(discount.code)}
                                                    className="p-1 hover:bg-gray-100 rounded"
                                                >
                                                    {copiedId === discount.code ? (
                                                        <CheckCircle className="h-4 w-4 text-green-600" />
                                                    ) : (
                                                        <Copy className="h-4 w-4 text-gray-400" />
                                                    )}
                                                </button>
                                                {!discount.isActive && (
                                                    <Badge variant="outline" className="bg-gray-100 text-gray-600">
                                                        Inactivo
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 text-sm">
                                                <Badge className={discount.type === "PERCENTAGE" ? "bg-blue-100 text-blue-700 hover:bg-blue-100" : "bg-green-100 text-green-700 hover:bg-green-100"}>
                                                    {discount.type === "PERCENTAGE" 
                                                        ? `${discount.value}% OFF` 
                                                        : `S/ ${discount.value.toFixed(2)} OFF`}
                                                </Badge>
                                                {discount.event && (
                                                    <Badge variant="outline">
                                                        Solo: {discount.event.title}
                                                    </Badge>
                                                )}
                                                {discount.minPurchase && (
                                                    <span className="text-gray-500">
                                                        Min: S/ {discount.minPurchase.toFixed(2)}
                                                    </span>
                                                )}
                                                <span className="text-gray-500">
                                                    Usos: {discount._count.usages}
                                                    {discount.maxUses ? ` / ${discount.maxUses}` : ""}
                                                </span>
                                            </div>
                                            {discount.description && (
                                                <p className="text-xs text-gray-500">{discount.description}</p>
                                            )}
                                            {discount.validUntil && (
                                                <p className="text-xs text-gray-400">
                                                    Válido hasta: {new Date(discount.validUntil).toLocaleDateString("es-PE")}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button 
                                                size="sm" 
                                                variant="outline"
                                                onClick={() => handleEditDiscount(discount)}
                                            >
                                                <Edit2 className="h-4 w-4" />
                                            </Button>
                                            <Button 
                                                size="sm" 
                                                variant="outline"
                                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                                onClick={() => handleDeleteDiscount(discount.id)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                {discountCodes.length === 0 && (
                                    <div className="text-center py-8 text-gray-500">
                                        <Percent className="h-8 w-8 mx-auto mb-2 text-gray-300" />
                                        <p>No hay códigos de descuento</p>
                                        <p className="text-xs text-gray-400 mt-1">Crea tu primer código para ofrecer descuentos</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                </>
            )}

            {/* Modal de Detalle de Lote */}
            {(batchDetail || loadingDetail) && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
                        {loadingDetail ? (
                            <div className="p-8 text-center">
                                <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full mx-auto"></div>
                                <p className="mt-4 text-gray-500">Cargando detalles...</p>
                            </div>
                        ) : batchDetail && (
                            <>
                                {/* Header */}
                                <div className="border-b p-6 flex justify-between items-start">
                                    <div>
                                        <h2 className="text-xl font-bold text-gray-900">{batchDetail.reason}</h2>
                                        <p className="text-sm text-gray-500 mt-1">
                                            {batchDetail.event.title} · {batchDetail.ticketType.name}
                                        </p>
                                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                                            <span className="flex items-center gap-1">
                                                <Calendar className="h-3.5 w-3.5" />
                                                {new Date(batchDetail.createdAt).toLocaleDateString("es-PE", {
                                                    day: "2-digit",
                                                    month: "long",
                                                    year: "numeric"
                                                })}
                                            </span>
                                            {batchDetail.createdByUser && (
                                                <span className="flex items-center gap-1">
                                                    <User className="h-3.5 w-3.5" />
                                                    {batchDetail.createdByUser.name || batchDetail.createdByUser.email}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => setBatchDetail(null)}
                                        className="p-2 hover:bg-gray-100 rounded-full"
                                    >
                                        <X className="h-5 w-5 text-gray-500" />
                                    </button>
                                </div>

                                {/* Stats Summary */}
                                <div className="grid grid-cols-4 gap-4 p-6 bg-gray-50">
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-gray-900">{batchDetail.courtesyTickets.length}</p>
                                        <p className="text-xs text-gray-500">Total Entradas</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-green-600">
                                            {batchDetail.courtesyTickets.filter(t => t.status === "CLAIMED").length}
                                        </p>
                                        <p className="text-xs text-gray-500">Canjeadas</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-yellow-600">
                                            {batchDetail.courtesyTickets.filter(t => t.status === "PENDING").length}
                                        </p>
                                        <p className="text-xs text-gray-500">Pendientes</p>
                                    </div>
                                    <div className="text-center">
                                        <p className="text-2xl font-bold text-blue-600">
                                            {batchDetail.courtesyTickets.filter(t => t.generatedTicket?.scans && t.generatedTicket.scans.length > 0).length}
                                        </p>
                                        <p className="text-xs text-gray-500">Usadas</p>
                                    </div>
                                </div>

                                {/* Tickets List */}
                                <div className="p-6 overflow-y-auto max-h-[50vh]">
                                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                        <Ticket className="h-4 w-4" />
                                        Detalle de Entradas
                                    </h3>
                                    <div className="space-y-3">
                                        {batchDetail.courtesyTickets.map((ticket, idx) => (
                                            <div 
                                                key={ticket.id}
                                                className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                                            >
                                                <div className="flex justify-between items-start">
                                                    <div className="space-y-2">
                                                        <div className="flex items-center gap-3">
                                                            <span className="text-sm font-medium text-gray-500">#{idx + 1}</span>
                                                            <code className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                                                                {ticket.claimCode}
                                                            </code>
                                                            {getStatusBadge(ticket.status)}
                                                            {ticket.generatedTicket?.scans && ticket.generatedTicket.scans.length > 0 && (
                                                                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                                                                    <QrCode className="h-3 w-3 mr-1" />
                                                                    Escaneada
                                                                </Badge>
                                                            )}
                                                        </div>

                                                        {/* Asignado */}
                                                        {ticket.assignedName && (
                                                            <div className="flex items-center gap-2 text-sm text-purple-700 bg-purple-50 px-3 py-1.5 rounded">
                                                                <User className="h-3.5 w-3.5" />
                                                                <span className="font-medium">Pre-asignado:</span>
                                                                {ticket.assignedName} 
                                                                {ticket.assignedDni && <span className="text-purple-500">· DNI: {ticket.assignedDni}</span>}
                                                            </div>
                                                        )}

                                                        {/* Canjeado por */}
                                                        {ticket.status === "CLAIMED" && (
                                                            <div className="space-y-1">
                                                                {ticket.claimedByUser && (
                                                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                                                        <Mail className="h-3.5 w-3.5" />
                                                                        <span>Canjeado por:</span>
                                                                        <span className="font-medium">{ticket.claimedByUser.name || ticket.claimedByUser.email}</span>
                                                                    </div>
                                                                )}
                                                                {ticket.claimedAt && (
                                                                    <div className="flex items-center gap-2 text-xs text-gray-400">
                                                                        <Calendar className="h-3 w-3" />
                                                                        {new Date(ticket.claimedAt).toLocaleString("es-PE")}
                                                                    </div>
                                                                )}
                                                                {ticket.generatedTicket && (
                                                                    <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 px-3 py-1.5 rounded mt-2">
                                                                        <CheckCircle className="h-3.5 w-3.5" />
                                                                        <span className="font-medium">Asistente:</span>
                                                                        {ticket.generatedTicket.attendeeName}
                                                                        {ticket.generatedTicket.attendeeDni && (
                                                                            <span className="text-green-600">· DNI: {ticket.generatedTicket.attendeeDni}</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {ticket.generatedTicket?.scans && ticket.generatedTicket.scans.length > 0 && (
                                                                    <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 px-3 py-1.5 rounded mt-1">
                                                                        <QrCode className="h-3.5 w-3.5" />
                                                                        <span>Escaneado:</span>
                                                                        <span className="font-medium">
                                                                            {new Date(ticket.generatedTicket.scans[0].scannedAt).toLocaleString("es-PE")}
                                                                        </span>
                                                                        {ticket.generatedTicket.scans[0].eventDay && (
                                                                            <span>· {ticket.generatedTicket.scans[0].eventDay.name}</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Pendiente */}
                                                        {ticket.status === "PENDING" && (
                                                            <div className="flex items-center gap-2 text-sm text-yellow-700">
                                                                <AlertCircle className="h-3.5 w-3.5" />
                                                                <span>Aún no canjeado</span>
                                                                {ticket.expiresAt && (
                                                                    <span className="text-yellow-500">
                                                                        · Expira: {new Date(ticket.expiresAt).toLocaleDateString("es-PE")}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <button
                                                        onClick={() => copyToClipboard(ticket.claimCode, ticket.id)}
                                                        className="p-2 hover:bg-gray-100 rounded"
                                                        title="Copiar código"
                                                    >
                                                        {copiedId === ticket.id ? (
                                                            <CheckCircle className="h-4 w-4 text-green-600" />
                                                        ) : (
                                                            <Copy className="h-4 w-4 text-gray-400" />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="border-t p-4 flex justify-end gap-2">
                                    <Button 
                                        variant="outline"
                                        onClick={() => {
                                            const codes = batchDetail.courtesyTickets.map(t => t.claimCode).join("\n")
                                            navigator.clipboard.writeText(codes)
                                            setCopiedId("batch-all")
                                            setTimeout(() => setCopiedId(null), 2000)
                                        }}
                                    >
                                        {copiedId === "batch-all" ? (
                                            <>
                                                <CheckCircle className="h-4 w-4 mr-2" />
                                                Copiados
                                            </>
                                        ) : (
                                            <>
                                                <Copy className="h-4 w-4 mr-2" />
                                                Copiar todos los códigos
                                            </>
                                        )}
                                    </Button>
                                    <Button onClick={() => setBatchDetail(null)}>
                                        Cerrar
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}
