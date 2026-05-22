"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save } from "lucide-react"

export interface MerchVariantRow {
    id: string
    size: string | null
    sku: string
    stock: number
    reserved: number
    sold: number
    available: number
    isActive: boolean
}

interface MerchVariantManagerProps {
    productId: string
    initialVariants: MerchVariantRow[]
}

export function MerchVariantManager({ productId, initialVariants }: MerchVariantManagerProps) {
    const [variants, setVariants] = useState<MerchVariantRow[]>(initialVariants)
    const [saving, setSaving] = useState(false)
    const [dirty, setDirty] = useState<Record<string, { stock?: number; isActive?: boolean }>>({})

    const handleStockChange = (variantId: string, value: string) => {
        const stock = Math.max(0, Math.floor(Number(value) || 0))
        setVariants((prev) =>
            prev.map((v) => (v.id === variantId ? { ...v, stock, available: Math.max(0, stock - v.reserved - v.sold) } : v))
        )
        setDirty((prev) => ({ ...prev, [variantId]: { ...prev[variantId], stock } }))
    }

    const handleActiveChange = (variantId: string, isActive: boolean) => {
        setVariants((prev) => prev.map((v) => (v.id === variantId ? { ...v, isActive } : v)))
        setDirty((prev) => ({ ...prev, [variantId]: { ...prev[variantId], isActive } }))
    }

    const handleSave = async () => {
        const updates = Object.entries(dirty).map(([variantId, changes]) => ({ variantId, ...changes }))
        if (updates.length === 0) {
            toast.info("No hay cambios para guardar")
            return
        }

        setSaving(true)
        try {
            const res = await fetch(`/api/admin/merch/${productId}/variants`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ updates }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || "Error al guardar")
            toast.success("Stock actualizado")
            setDirty({})
            if (Array.isArray(data.data)) {
                setVariants(data.data)
            }
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="bg-white rounded-xl border border-border p-5 space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-lg text-foreground">Variantes y stock</h3>
                <Button onClick={handleSave} loading={saving} disabled={Object.keys(dirty).length === 0}>
                    <Save className="h-4 w-4" />
                    Guardar
                </Button>
            </div>

            {variants.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay variantes.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border text-left">
                                <th className="py-2 pr-3 font-semibold text-xs uppercase text-muted-foreground">Talla</th>
                                <th className="py-2 pr-3 font-semibold text-xs uppercase text-muted-foreground">SKU</th>
                                <th className="py-2 pr-3 font-semibold text-xs uppercase text-muted-foreground w-28">Stock</th>
                                <th className="py-2 pr-3 font-semibold text-xs uppercase text-muted-foreground text-right">Reservado</th>
                                <th className="py-2 pr-3 font-semibold text-xs uppercase text-muted-foreground text-right">Vendido</th>
                                <th className="py-2 pr-3 font-semibold text-xs uppercase text-muted-foreground text-right">Disponible</th>
                                <th className="py-2 pr-3 font-semibold text-xs uppercase text-muted-foreground">Activo</th>
                            </tr>
                        </thead>
                        <tbody>
                            {variants.map((variant) => (
                                <tr key={variant.id} className="border-b border-border/50">
                                    <td className="py-3 pr-3 font-semibold">
                                        {variant.size || "Única"}
                                    </td>
                                    <td className="py-3 pr-3 text-muted-foreground font-mono text-xs">{variant.sku}</td>
                                    <td className="py-3 pr-3">
                                        <Input
                                            type="number"
                                            min="0"
                                            value={variant.stock}
                                            onChange={(e) => handleStockChange(variant.id, e.target.value)}
                                            className="h-9"
                                        />
                                    </td>
                                    <td className="py-3 pr-3 text-right">{variant.reserved}</td>
                                    <td className="py-3 pr-3 text-right">{variant.sold}</td>
                                    <td className="py-3 pr-3 text-right font-bold text-fdnda-primary">{variant.available}</td>
                                    <td className="py-3 pr-3">
                                        <label className="inline-flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={variant.isActive}
                                                onChange={(e) => handleActiveChange(variant.id, e.target.checked)}
                                                className="h-4 w-4 rounded border-border"
                                            />
                                        </label>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <p className="text-xs text-muted-foreground">
                <strong>Disponible</strong> = Stock − Reservado − Vendido. Las reservas se liberan cuando una orden expira sin pago.
            </p>
        </div>
    )
}
