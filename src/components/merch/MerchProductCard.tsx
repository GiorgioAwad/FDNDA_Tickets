"use client"

import { useState } from "react"
import { motion, useReducedMotion } from "framer-motion"
import { ShoppingBag, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/utils"
import { cn } from "@/lib/utils"
import type { MerchProductView } from "./types"
import { ZONE_THEME } from "./theme"

interface MerchProductCardProps {
    product: MerchProductView
    onOpen: (product: MerchProductView) => void
    priority?: boolean
}

export function MerchProductCard({ product, onOpen, priority }: MerchProductCardProps) {
    const prefersReducedMotion = useReducedMotion()
    const zoneTheme = ZONE_THEME[product.zone]
    const categoryLabel = product.category === "POLERA" ? "Polera" : product.category === "GORRA" ? "Gorra" : product.category === "PIN" ? "Pin" : "Producto"
    const displayImageUrl = product.imageUrl || product.imageUrls[0] || null
    const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null)
    const imageFailed = Boolean(displayImageUrl && failedImageUrl === displayImageUrl)

    return (
        <motion.button
            type="button"
            onClick={() => onOpen(product)}
            whileHover={prefersReducedMotion ? undefined : { y: -6 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="group text-left h-full focus:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-primary focus-visible:ring-offset-2 rounded-2xl"
        >
            <article className="relative h-full flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all duration-300 group-hover:shadow-card-hover">
                <div className={cn("relative aspect-[3/4] overflow-hidden", zoneTheme.bg)}>
                    {displayImageUrl && !imageFailed ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={displayImageUrl}
                            alt={product.name}
                            loading={priority ? "eager" : "lazy"}
                            onError={() => setFailedImageUrl(displayImageUrl)}
                            className="absolute inset-0 h-full w-full object-contain p-4 transition-transform duration-700 group-hover:scale-105 drop-shadow-xl"
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-fdnda-primary/60">
                            <ShoppingBag className="h-16 w-16" />
                            <span className="text-xs font-semibold uppercase tracking-widest text-fdnda-primary/70">
                                {categoryLabel}
                            </span>
                        </div>
                    )}

                    <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
                        <Badge className={cn("font-semibold shadow-md", zoneTheme.badge)}>
                            {product.zone === "GENERICA" ? categoryLabel : `Zona ${zoneTheme.short}`}
                        </Badge>
                        {product.etapa && (
                            <Badge className="bg-white/95 backdrop-blur-sm text-foreground font-semibold shadow-md">
                                Etapa {product.etapa}
                            </Badge>
                        )}
                    </div>

                    {product.isSoldOut && (
                        <div className="absolute inset-0 bg-black/55 flex items-center justify-center backdrop-blur-[2px]">
                            <Badge className="bg-white text-foreground text-sm font-bold uppercase tracking-wider shadow-elevated">
                                Agotado
                            </Badge>
                        </div>
                    )}
                </div>

                <div className="p-4 flex-1 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                        <h3 className="font-display font-semibold text-foreground leading-tight line-clamp-2">
                            {product.name}
                        </h3>
                    </div>
                    <div className="flex items-center justify-between mt-auto pt-2">
                        <span className="text-2xl font-display font-bold text-fdnda-primary">
                            {formatPrice(product.price)}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-fdnda-secondary group-hover:translate-x-0.5 transition-transform">
                            <Sparkles className="h-3 w-3" />
                            Ver
                        </span>
                    </div>
                </div>
            </article>
        </motion.button>
    )
}
