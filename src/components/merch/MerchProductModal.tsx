"use client"

import { useEffect, useMemo, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Check, Minus, Plus, ShoppingBag, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useMerchCart } from "@/hooks/merch-cart-context"
import { formatPrice, cn } from "@/lib/utils"
import { MerchSpinPreview } from "./MerchSpinPreview"
import { ZONE_THEME, CATEGORY_SINGULAR } from "./theme"
import type { MerchProductView, MerchVariantView } from "./types"

interface MerchProductModalProps {
    product: MerchProductView | null
    onClose: () => void
}

export function MerchProductModal({ product, onClose }: MerchProductModalProps) {
    const { addItem } = useMerchCart()
    const [trackedProductId, setTrackedProductId] = useState<string | null>(null)
    const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null)
    const [quantity, setQuantity] = useState(1)
    const [confirmation, setConfirmation] = useState(false)
    const displayImageUrl = product?.imageUrl || product?.imageUrls[0] || null

    // Resetear estado cuando se abre un producto distinto (sin useEffect — patrón React 19)
    if (product && product.id !== trackedProductId) {
        const initial = !product.hasSizes && product.variants.length === 1
            ? product.variants[0].id
            : product.variants.find((v) => v.available > 0)?.id ?? null
        setTrackedProductId(product.id)
        setSelectedVariantId(initial)
        setQuantity(1)
        setConfirmation(false)
    }

    useEffect(() => {
        if (!product) return
        const handler = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose()
        }
        document.body.style.overflow = "hidden"
        document.addEventListener("keydown", handler)
        return () => {
            document.body.style.overflow = ""
            document.removeEventListener("keydown", handler)
        }
    }, [product, onClose])

    const selectedVariant = useMemo<MerchVariantView | null>(() => {
        if (!product || !selectedVariantId) return null
        return product.variants.find((v) => v.id === selectedVariantId) ?? null
    }, [product, selectedVariantId])

    const maxQuantity = selectedVariant ? Math.min(selectedVariant.available, 10) : 0
    const canAdd = product != null && selectedVariant != null && selectedVariant.available > 0 && quantity > 0

    const handleAdd = () => {
        if (!product || !selectedVariant || !canAdd) return
        addItem({
            productId: product.id,
            variantId: selectedVariant.id,
            productName: product.name,
            category: product.category,
            zone: product.zone,
            size: selectedVariant.size,
            imageUrl: displayImageUrl,
            price: product.price,
            quantity,
        })
        setConfirmation(true)
        setTimeout(() => {
            setConfirmation(false)
            onClose()
        }, 1100)
    }

    return (
        <AnimatePresence>
            {product && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-3 sm:p-6 lg:items-center"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.94, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.96, opacity: 0, y: 10 }}
                        transition={{ type: "spring", damping: 22, stiffness: 240 }}
                        className="relative my-3 w-full max-w-5xl overflow-visible rounded-2xl bg-white shadow-elevated grid grid-cols-1 lg:my-0 lg:max-h-[92vh] lg:overflow-hidden lg:rounded-3xl lg:grid-cols-[1.1fr,1fr]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Cerrar"
                            className="absolute top-3 right-3 z-10 rounded-full bg-white/95 backdrop-blur-sm p-2 shadow-md hover:bg-white text-foreground transition"
                        >
                            <X className="h-5 w-5" />
                        </button>

                        {/* Spin preview */}
                        <div className="relative h-[38vh] min-h-[220px] max-h-[360px] lg:h-[92vh] lg:max-h-[700px]">
                            <MerchSpinPreview
                                imageUrl={displayImageUrl}
                                alt={product.name}
                                bgClass={ZONE_THEME[product.zone].bg}
                            />
                        </div>

                        {/* Details */}
                        <div className="flex flex-col gap-4 p-5 sm:p-8 lg:overflow-y-auto">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge className={ZONE_THEME[product.zone].badge}>
                                    {product.zone === "GENERICA" ? CATEGORY_SINGULAR[product.category] : `Zona ${ZONE_THEME[product.zone].short}`}
                                </Badge>
                                {product.etapa && (
                                    <Badge variant="outline" className="font-semibold">
                                        Etapa {product.etapa}
                                    </Badge>
                                )}
                                <Badge variant="outline" className="font-semibold">
                                    {CATEGORY_SINGULAR[product.category]}
                                </Badge>
                            </div>

                            <div>
                                <h2 className="font-display text-3xl sm:text-4xl font-bold text-foreground leading-tight">
                                    {product.name}
                                </h2>
                                <p className="text-3xl font-display font-bold text-fdnda-primary mt-3">
                                    {formatPrice(product.price)}
                                </p>
                            </div>

                            {product.description && (
                                <p className="text-sm text-muted-foreground leading-relaxed">
                                    {product.description}
                                </p>
                            )}

                            {/* Size selector */}
                            {product.hasSizes && (
                                <div className="mt-2">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-semibold text-foreground">Selecciona tu talla</p>
                                        {selectedVariant?.size && (
                                            <span className="text-xs text-muted-foreground">
                                                {selectedVariant.available > 0 ? `${selectedVariant.available} disponibles` : "Agotado"}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {product.variants.map((variant) => {
                                            const available = variant.available > 0
                                            const isSelected = variant.id === selectedVariantId
                                            return (
                                                <button
                                                    key={variant.id}
                                                    type="button"
                                                    disabled={!available}
                                                    onClick={() => {
                                                        setSelectedVariantId(variant.id)
                                                        setQuantity(1)
                                                    }}
                                                    className={cn(
                                                        "relative h-11 min-w-[3rem] rounded-full px-4 text-sm font-semibold border-2 transition-all",
                                                        isSelected
                                                            ? "border-fdnda-primary bg-fdnda-primary text-white shadow-glow-primary"
                                                            : available
                                                                ? "border-border bg-white text-foreground hover:border-fdnda-primary"
                                                                : "border-border bg-gray-100 text-muted-foreground line-through cursor-not-allowed"
                                                    )}
                                                >
                                                    {variant.size}
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Quantity */}
                            <div className="mt-1">
                                <p className="text-sm font-semibold text-foreground mb-2">Cantidad</p>
                                <div className="inline-flex items-center rounded-full border border-border overflow-hidden">
                                    <button
                                        type="button"
                                        disabled={quantity <= 1}
                                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                                        className="h-11 w-11 inline-flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
                                    >
                                        <Minus className="h-4 w-4" />
                                    </button>
                                    <span className="h-11 px-5 inline-flex items-center justify-center text-base font-semibold min-w-[3rem]">
                                        {quantity}
                                    </span>
                                    <button
                                        type="button"
                                        disabled={quantity >= maxQuantity}
                                        onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
                                        className="h-11 w-11 inline-flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"
                                    >
                                        <Plus className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>

                            <div className="mt-auto pt-4">
                                {confirmation ? (
                                    <motion.div
                                        initial={{ scale: 0.9, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        className="h-12 sm:h-14 rounded-xl bg-green-600 text-white inline-flex items-center justify-center w-full font-semibold gap-2"
                                    >
                                        <Check className="h-5 w-5" />
                                        Agregado al carrito
                                    </motion.div>
                                ) : (
                                    <Button
                                        size="xl"
                                        variant="coral"
                                        className="w-full rounded-xl"
                                        disabled={!canAdd}
                                        onClick={handleAdd}
                                    >
                                        <ShoppingBag className="h-5 w-5" />
                                        {!product.hasSizes || selectedVariant ? (
                                            <>
                                                Agregar al carrito · {formatPrice(product.price * quantity)}
                                            </>
                                        ) : (
                                            "Elige una talla"
                                        )}
                                    </Button>
                                )}
                                <p className="text-[11px] text-center text-muted-foreground mt-3">
                                    Pago seguro Izipay · Boleta o factura · Recojo o envío
                                </p>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    )
}
