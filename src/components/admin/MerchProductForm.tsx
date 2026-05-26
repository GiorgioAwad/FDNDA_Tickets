"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ImageUploader } from "@/components/ui/image-uploader"
import { Save, Trash2 } from "lucide-react"

type Category = "POLERA" | "GORRA" | "PIN" | "OTROS"
type Zone = "LIMA" | "SUR" | "NORTE" | "ORIENTE" | "GENERICA"

interface ServilexServiceOption {
    id: string
    codigo: string
    descripcion: string
}

interface MerchProductFormData {
    id?: string
    name: string
    description: string
    category: Category
    zone: Zone
    etapa: string
    price: number | string
    imageUrl: string
    hasSizes: boolean
    availableSizes: string[]
    isActive: boolean
    sortOrder: number
    servilexServiceId: string | null
    initialStock?: number
}

interface MerchProductFormProps {
    initialData?: Partial<MerchProductFormData>
    isEdit?: boolean
}

const DEFAULT_SIZES = ["S", "M", "L", "XL"]

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
    { value: "POLERA", label: "Polera" },
    { value: "GORRA", label: "Gorra" },
    { value: "PIN", label: "Pin" },
    { value: "OTROS", label: "Otros" },
]

const ZONE_OPTIONS: { value: Zone; label: string }[] = [
    { value: "GENERICA", label: "Genérica (sin zona)" },
    { value: "LIMA", label: "Zona 1 — Lima" },
    { value: "SUR", label: "Zona 2 — Sur" },
    { value: "NORTE", label: "Zona 3 — Norte" },
    { value: "ORIENTE", label: "Zona 4 — Oriente" },
]

export function MerchProductForm({ initialData, isEdit = false }: MerchProductFormProps) {
    const router = useRouter()
    const [submitting, setSubmitting] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [servilexServices, setServilexServices] = useState<ServilexServiceOption[]>([])

    const [form, setForm] = useState<MerchProductFormData>({
        name: initialData?.name ?? "",
        description: initialData?.description ?? "",
        category: (initialData?.category as Category) ?? "POLERA",
        zone: (initialData?.zone as Zone) ?? "GENERICA",
        etapa: initialData?.etapa ?? "",
        price: initialData?.price ?? "",
        imageUrl: initialData?.imageUrl ?? "",
        hasSizes: initialData?.hasSizes ?? true,
        availableSizes: initialData?.availableSizes && initialData.availableSizes.length > 0
            ? initialData.availableSizes
            : DEFAULT_SIZES,
        isActive: initialData?.isActive ?? true,
        sortOrder: initialData?.sortOrder ?? 0,
        servilexServiceId: initialData?.servilexServiceId ?? null,
        initialStock: 0,
    })

    useEffect(() => {
        let cancelled = false
        fetch("/api/admin/servilex-services?indicator=OS")
            .then((res) => res.json())
            .then((data) => {
                if (cancelled) return
                if (data?.success && Array.isArray(data.data)) {
                    setServilexServices(data.data)
                }
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [])

    // Auto-suggest hasSizes based on category
    useEffect(() => {
        if (isEdit) return
        if (form.category === "POLERA") {
            setForm((f) => ({ ...f, hasSizes: true, availableSizes: f.availableSizes.length ? f.availableSizes : DEFAULT_SIZES }))
        } else {
            setForm((f) => ({ ...f, hasSizes: false }))
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [form.category])

    const toggleSize = (size: string) => {
        setForm((f) => ({
            ...f,
            availableSizes: f.availableSizes.includes(size)
                ? f.availableSizes.filter((s) => s !== size)
                : [...f.availableSizes, size],
        }))
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (submitting) return

        if (!form.name.trim()) {
            toast.error("El nombre es requerido")
            return
        }
        const priceNum = Number(form.price)
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
            toast.error("El precio debe ser mayor a 0")
            return
        }
        if (form.hasSizes && form.availableSizes.length === 0) {
            toast.error("Indica al menos una talla")
            return
        }

        setSubmitting(true)
        try {
            const url = isEdit && initialData?.id ? `/api/admin/merch/${initialData.id}` : "/api/admin/merch"
            const method = isEdit ? "PATCH" : "POST"

            const payload = {
                name: form.name.trim(),
                description: form.description.trim() || null,
                category: form.category,
                zone: form.zone,
                etapa: form.etapa.trim() || null,
                price: priceNum,
                imageUrl: form.imageUrl || null,
                hasSizes: form.hasSizes,
                availableSizes: form.hasSizes ? form.availableSizes : null,
                isActive: form.isActive,
                sortOrder: Number(form.sortOrder) || 0,
                servilexServiceId: form.servilexServiceId,
                ...(isEdit ? {} : { initialStock: Number(form.initialStock) || 0 }),
            }

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || "Error al guardar")
            }

            toast.success(isEdit ? "Producto actualizado" : "Producto creado")
            if (!isEdit && data.data?.id) {
                router.push(`/admin/merch/${data.data.id}`)
            } else {
                router.push("/admin/merch")
                router.refresh()
            }
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async () => {
        if (!initialData?.id || !isEdit) return
        if (!confirm("¿Eliminar este producto? Si tiene historial de ventas se marcará como inactivo.")) return

        setDeleting(true)
        try {
            const res = await fetch(`/api/admin/merch/${initialData.id}`, { method: "DELETE" })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || "Error al eliminar")

            toast.success(data.softDeleted ? "Producto marcado como inactivo" : "Producto eliminado")
            router.push("/admin/merch")
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            setDeleting(false)
        }
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
                        <h3 className="font-display font-bold text-lg text-foreground">Datos del producto</h3>

                        <div>
                            <label className="text-sm font-semibold text-foreground block mb-1.5">Nombre *</label>
                            <Input
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.target.value })}
                                placeholder="Polera Oficial — Zona 1 Lima"
                                required
                            />
                        </div>

                        <div>
                            <label className="text-sm font-semibold text-foreground block mb-1.5">Descripción</label>
                            <textarea
                                value={form.description}
                                onChange={(e) => setForm({ ...form, description: e.target.value })}
                                rows={3}
                                placeholder="Polera unisex 100% algodón. Edición limitada del Campeonato Descentralizado."
                                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-semibold text-foreground block mb-1.5">Categoría *</label>
                                <select
                                    value={form.category}
                                    onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    {CATEGORY_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-foreground block mb-1.5">Zona *</label>
                                <select
                                    value={form.zone}
                                    onChange={(e) => setForm({ ...form, zone: e.target.value as Zone })}
                                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                >
                                    {ZONE_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-sm font-semibold text-foreground block mb-1.5">Precio (S/) *</label>
                                <Input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={form.price}
                                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                                    placeholder="80.00"
                                    required
                                />
                            </div>
                            <div>
                                <label className="text-sm font-semibold text-foreground block mb-1.5">Etapa (opcional)</label>
                                <Input
                                    value={form.etapa}
                                    onChange={(e) => setForm({ ...form, etapa: e.target.value })}
                                    placeholder="1-A"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-display font-bold text-lg text-foreground">Tallas</h3>
                            <label className="inline-flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={form.hasSizes}
                                    onChange={(e) => setForm({ ...form, hasSizes: e.target.checked })}
                                    className="h-4 w-4 rounded border-border"
                                />
                                <span>Este producto tiene tallas</span>
                            </label>
                        </div>

                        {form.hasSizes && (
                            <div>
                                <p className="text-xs text-muted-foreground mb-2">Tallas disponibles:</p>
                                <div className="flex flex-wrap gap-2">
                                    {DEFAULT_SIZES.concat(["XXL", "UNI"]).map((size) => {
                                        const selected = form.availableSizes.includes(size)
                                        return (
                                            <button
                                                key={size}
                                                type="button"
                                                onClick={() => toggleSize(size)}
                                                className={`h-10 min-w-[3rem] px-4 rounded-full text-sm font-semibold border-2 transition-all ${
                                                    selected
                                                        ? "bg-fdnda-primary text-white border-fdnda-primary"
                                                        : "bg-white text-foreground border-border hover:border-fdnda-primary"
                                                }`}
                                            >
                                                {size}
                                            </button>
                                        )
                                    })}
                                </div>
                                {!isEdit && (
                                    <p className="text-xs text-muted-foreground mt-3">
                                        Al crear el producto se generará una variante por talla seleccionada.
                                    </p>
                                )}
                            </div>
                        )}

                        {!isEdit && (
                            <div>
                                <label className="text-sm font-semibold text-foreground block mb-1.5">
                                    Stock inicial {form.hasSizes ? "por talla" : ""}
                                </label>
                                <Input
                                    type="number"
                                    min="0"
                                    value={form.initialStock ?? 0}
                                    onChange={(e) => setForm({ ...form, initialStock: Number(e.target.value) })}
                                    placeholder="30"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    Puedes ajustar el stock por variante después.
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
                        <h3 className="font-display font-bold text-lg text-foreground">Facturación (Servilex)</h3>
                        <div>
                            <label className="text-sm font-semibold text-foreground block mb-1.5">
                                Servicio Servilex (opcional)
                            </label>
                            <select
                                value={form.servilexServiceId ?? ""}
                                onChange={(e) => setForm({ ...form, servilexServiceId: e.target.value || null })}
                                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                            >
                                <option value="">— Sin Servilex (sin boleta automática) —</option>
                                {servilexServices.map((svc) => (
                                    <option key={svc.id} value={svc.id}>
                                        {svc.codigo} · {svc.descripcion}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-muted-foreground mt-1">
                                Si vinculas un servicio, las ventas se enviarán a Servilex para emisión de boleta automática.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
                        <h3 className="font-display font-bold text-lg text-foreground">Imagen</h3>
                        <ImageUploader
                            value={form.imageUrl}
                            onChange={(url) => setForm({ ...form, imageUrl: url })}
                            type="merch"
                            label=""
                            placeholder="URL de la imagen del producto"
                        />
                    </div>

                    <div className="bg-white rounded-xl border border-border p-5 space-y-4">
                        <h3 className="font-display font-bold text-lg text-foreground">Visibilidad</h3>
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                                className="h-4 w-4 rounded border-border"
                            />
                            <span>Producto activo (visible en /merch)</span>
                        </label>
                        <div>
                            <label className="text-sm font-semibold text-foreground block mb-1.5">Orden</label>
                            <Input
                                type="number"
                                value={form.sortOrder}
                                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                            />
                            <p className="text-xs text-muted-foreground mt-1">Menor número aparece primero.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex items-center justify-between bg-white rounded-xl border border-border p-4">
                {isEdit ? (
                    <Button type="button" variant="destructive" onClick={handleDelete} loading={deleting}>
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                    </Button>
                ) : <div />}
                <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => router.push("/admin/merch")}>
                        Cancelar
                    </Button>
                    <Button type="submit" loading={submitting}>
                        <Save className="h-4 w-4" />
                        {isEdit ? "Guardar cambios" : "Crear producto"}
                    </Button>
                </div>
            </div>
        </form>
    )
}
