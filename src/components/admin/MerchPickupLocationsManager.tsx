"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
    Building2,
    CheckCircle2,
    Loader2,
    MapPin,
    PackageCheck,
    Pencil,
    Plus,
    Power,
    Save,
    Trash2,
    X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface AdminMerchPickupLocation {
    id: string
    name: string
    address: string
    district: string | null
    instructions: string | null
    isActive: boolean
    sortOrder: number
    createdAt: string
    updatedAt: string
    _count: { orders: number; products: number }
}

interface LocationForm {
    name: string
    address: string
    district: string
    instructions: string
    sortOrder: number
    isActive: boolean
}

const EMPTY_FORM: LocationForm = {
    name: "",
    address: "",
    district: "",
    instructions: "",
    sortOrder: 0,
    isActive: true,
}

function sortLocations(locations: AdminMerchPickupLocation[]) {
    return [...locations].sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
        return a.name.localeCompare(b.name, "es")
    })
}

export function MerchPickupLocationsManager({
    initialLocations,
}: {
    initialLocations: AdminMerchPickupLocation[]
}) {
    const [locations, setLocations] = useState(() => sortLocations(initialLocations))
    const [form, setForm] = useState<LocationForm>(EMPTY_FORM)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [busyId, setBusyId] = useState<string | null>(null)

    const activeCount = locations.filter((location) => location.isActive).length

    function resetForm() {
        setEditingId(null)
        setForm(EMPTY_FORM)
    }

    function editLocation(location: AdminMerchPickupLocation) {
        setEditingId(location.id)
        setForm({
            name: location.name,
            address: location.address,
            district: location.district ?? "",
            instructions: location.instructions ?? "",
            sortOrder: location.sortOrder,
            isActive: location.isActive,
        })
        window.scrollTo({ top: 0, behavior: "smooth" })
    }

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        if (!form.name.trim() || !form.address.trim()) {
            toast.error("Completa el nombre y la direccion de la sede.")
            return
        }

        setSaving(true)
        try {
            const response = await fetch(
                editingId
                    ? `/api/admin/merch/pickup-locations/${editingId}`
                    : "/api/admin/merch/pickup-locations",
                {
                    method: editingId ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...form,
                        district: form.district.trim() || null,
                        instructions: form.instructions.trim() || null,
                    }),
                }
            )
            const payload = await response.json()
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || "No se pudo guardar la sede.")
            }

            const saved = payload.data as AdminMerchPickupLocation
            setLocations((current) =>
                sortLocations(
                    editingId
                        ? current.map((location) => (location.id === saved.id ? saved : location))
                        : [...current, saved]
                )
            )
            toast.success(editingId ? "Sede actualizada." : "Sede creada y disponible en el checkout.")
            resetForm()
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            setSaving(false)
        }
    }

    async function toggleLocation(location: AdminMerchPickupLocation) {
        setBusyId(location.id)
        try {
            const response = await fetch(`/api/admin/merch/pickup-locations/${location.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isActive: !location.isActive }),
            })
            const payload = await response.json()
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || "No se pudo cambiar el estado.")
            }
            const updated = payload.data as AdminMerchPickupLocation
            setLocations((current) =>
                sortLocations(current.map((item) => (item.id === updated.id ? updated : item)))
            )
            toast.success(updated.isActive ? "Sede activada." : "Sede retirada del checkout.")
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            setBusyId(null)
        }
    }

    async function removeLocation(location: AdminMerchPickupLocation) {
        const confirmed = window.confirm(
            location._count.orders > 0
                ? "Esta sede tiene pedidos asociados. Se desactivara para conservar el historial. ¿Continuar?"
                : "¿Eliminar esta sede de recojo? Esta accion no se puede deshacer."
        )
        if (!confirmed) return

        setBusyId(location.id)
        try {
            const response = await fetch(`/api/admin/merch/pickup-locations/${location.id}`, {
                method: "DELETE",
            })
            const payload = await response.json()
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || "No se pudo retirar la sede.")
            }

            if (payload.deleted) {
                setLocations((current) => current.filter((item) => item.id !== location.id))
            } else {
                const updated = payload.data as AdminMerchPickupLocation
                setLocations((current) =>
                    sortLocations(current.map((item) => (item.id === updated.id ? updated : item)))
                )
            }
            if (editingId === location.id) resetForm()
            toast.success(payload.message || "Sede eliminada.")
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            setBusyId(null)
        }
    }

    return (
        <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 p-4 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-2xl">
                    <h1 className="font-display text-3xl font-bold text-foreground">Sedes de recojo</h1>
                    <p className="mt-1 break-words text-sm text-muted-foreground">
                        Define los lugares que el comprador podrá elegir al pagar merch. Las ediciones no cambian los pedidos anteriores.
                    </p>
                </div>
                <div className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    {activeCount} {activeCount === 1 ? "sede activa" : "sedes activas"}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)] lg:items-start">
                <section aria-labelledby="locations-heading" className="min-w-0">
                    <div className="mb-3 flex items-center justify-between">
                        <h2 id="locations-heading" className="font-display text-xl font-bold text-foreground">
                            Sedes configuradas
                        </h2>
                        <span className="text-sm text-muted-foreground">{locations.length} en total</span>
                    </div>

                    {locations.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border bg-white p-8 text-center">
                            <Building2 className="mx-auto h-9 w-9 text-fdnda-secondary" />
                            <h3 className="mt-3 font-semibold text-foreground">Aún no hay sedes de recojo</h3>
                            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                                Crea la primera sede. Cuando esté activa aparecerá automáticamente en el checkout.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {locations.map((location) => {
                                const busy = busyId === location.id
                                const hasProducts = location._count.products > 0
                                return (
                                    <article
                                        key={location.id}
                                        className={cn(
                                            "rounded-2xl border bg-white p-4 sm:p-5",
                                            location.isActive ? "border-border" : "border-dashed border-slate-300 bg-slate-50/60"
                                        )}
                                    >
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <h3 className="font-semibold text-foreground break-words">{location.name}</h3>
                                                    <span
                                                        className={cn(
                                                            "rounded-full px-2.5 py-1 text-xs font-semibold",
                                                            location.isActive
                                                                ? "bg-emerald-50 text-emerald-800"
                                                                : "bg-slate-200 text-slate-700"
                                                        )}
                                                    >
                                                        {location.isActive ? "Activa" : "Inactiva"}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground">Orden {location.sortOrder}</span>
                                                </div>
                                                <div className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                                                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                                                    <span className="break-words">
                                                        {location.address}
                                                        {location.district ? `, ${location.district}` : ""}
                                                    </span>
                                                </div>
                                                {location.instructions && (
                                                    <p className="mt-2 max-w-2xl text-sm text-muted-foreground break-words">
                                                        {location.instructions}
                                                    </p>
                                                )}
                                                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <PackageCheck className="h-4 w-4" />
                                                        {location._count.orders} {location._count.orders === 1 ? "pedido asociado" : "pedidos asociados"}
                                                    </span>
                                                    <span className="inline-flex items-center gap-1.5">
                                                        <Building2 className="h-4 w-4" />
                                                        {location._count.products} {location._count.products === 1 ? "producto asignado" : "productos asignados"}
                                                    </span>
                                                </div>
                                                {hasProducts && location.isActive && (
                                                    <p className="mt-2 text-xs text-amber-700">
                                                        Reasigna los productos antes de desactivar o eliminar esta sede.
                                                    </p>
                                                )}
                                            </div>

                                            <div className="flex shrink-0 flex-wrap gap-2">
                                                <Button type="button" variant="ghost" size="sm" onClick={() => editLocation(location)} disabled={busy}>
                                                    <Pencil className="h-4 w-4" />
                                                    Editar
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => toggleLocation(location)}
                                                    disabled={busy || (location.isActive && hasProducts)}
                                                    title={location.isActive && hasProducts ? "Reasigna primero los productos vinculados" : undefined}
                                                >
                                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                                                    {location.isActive ? "Desactivar" : "Activar"}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    aria-label={`Eliminar ${location.name}`}
                                                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                                                    onClick={() => removeLocation(location)}
                                                    disabled={busy || hasProducts}
                                                    title={hasProducts ? "Reasigna primero los productos vinculados" : undefined}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </article>
                                )
                            })}
                        </div>
                    )}
                </section>

                <section aria-labelledby="location-form-heading" className="min-w-0 rounded-2xl border border-border bg-white p-5 lg:sticky lg:top-20">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <h2 id="location-form-heading" className="font-display text-xl font-bold text-foreground">
                                {editingId ? "Editar sede" : "Nueva sede"}
                            </h2>
                            <p className="mt-1 text-sm text-muted-foreground">
                                Usa una dirección precisa e indica la puerta o módulo de entrega.
                            </p>
                        </div>
                        {editingId && (
                            <Button type="button" variant="ghost" size="icon" onClick={resetForm} aria-label="Cancelar edición">
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>

                    <form onSubmit={submit} className="mt-5 space-y-4">
                        <div>
                            <label htmlFor="pickup-name" className="mb-1.5 block text-sm font-semibold text-foreground">
                                Nombre de la sede *
                            </label>
                            <Input
                                id="pickup-name"
                                value={form.name}
                                onChange={(event) => setForm({ ...form, name: event.target.value })}
                                placeholder="Ej. Videna"
                                maxLength={100}
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="pickup-address" className="mb-1.5 block text-sm font-semibold text-foreground">
                                Dirección de recojo *
                            </label>
                            <Input
                                id="pickup-address"
                                value={form.address}
                                onChange={(event) => setForm({ ...form, address: event.target.value })}
                                placeholder="Av. Canadá 30"
                                maxLength={240}
                                required
                            />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                            <div>
                                <label htmlFor="pickup-district" className="mb-1.5 block text-sm font-semibold text-foreground">
                                    Distrito
                                </label>
                                <Input
                                    id="pickup-district"
                                    value={form.district}
                                    onChange={(event) => setForm({ ...form, district: event.target.value })}
                                    placeholder="San Luis"
                                    maxLength={100}
                                />
                            </div>
                            <div>
                                <label htmlFor="pickup-order" className="mb-1.5 block text-sm font-semibold text-foreground">
                                    Orden de aparición
                                </label>
                                <Input
                                    id="pickup-order"
                                    type="number"
                                    min={0}
                                    max={9999}
                                    value={form.sortOrder}
                                    onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) || 0 })}
                                />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="pickup-instructions" className="mb-1.5 block text-sm font-semibold text-foreground">
                                Indicaciones para el comprador
                            </label>
                            <textarea
                                id="pickup-instructions"
                                value={form.instructions}
                                onChange={(event) => setForm({ ...form, instructions: event.target.value })}
                                placeholder="Ej. Acércate al módulo FDNDA de la puerta 2 con tu DNI."
                                maxLength={500}
                                rows={4}
                                className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-sm"
                            />
                            <p className="mt-1 text-right text-xs text-muted-foreground">{form.instructions.length}/500</p>
                        </div>
                        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-fdnda-light/50 p-3">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
                                className="mt-0.5 h-4 w-4 accent-[hsl(var(--fdnda-primary))]"
                            />
                            <span>
                                <span className="block text-sm font-semibold text-foreground">Mostrar en el checkout</span>
                                <span className="block text-xs text-muted-foreground">
                                    Si está inactiva, ningún pedido nuevo podrá seleccionarla.
                                </span>
                            </span>
                        </label>

                        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                            {editingId && (
                                <Button type="button" variant="ghost" onClick={resetForm} disabled={saving}>
                                    Cancelar
                                </Button>
                            )}
                            <Button type="submit" loading={saving}>
                                {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                {editingId ? "Guardar cambios" : "Crear sede"}
                            </Button>
                        </div>
                    </form>
                </section>
            </div>
        </div>
    )
}
