"use client"

import { useMemo, useState } from "react"
import { motion } from "framer-motion"
import { Shirt, ShoppingBag, Tag } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"
import { MerchProductCard } from "./MerchProductCard"
import { MerchProductModal } from "./MerchProductModal"
import { CATEGORY_LABEL, ZONE_THEME } from "./theme"
import type { MerchCategory, MerchProductView, MerchZone } from "./types"

interface MerchCatalogProps {
    products: MerchProductView[]
}

type ZoneFilter = MerchZone | "ALL"
type CategoryFilter = MerchCategory | "ALL"

const ZONE_FILTERS: { value: ZoneFilter; label: string }[] = [
    { value: "ALL", label: "Todas las zonas" },
    { value: "LIMA", label: "Zona 1 · Lima" },
    { value: "SUR", label: "Zona 2 · Sur" },
    { value: "NORTE", label: "Zona 3 · Norte" },
    { value: "ORIENTE", label: "Zona 4 · Oriente" },
]

const CATEGORY_FILTERS: { value: CategoryFilter; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: "ALL", label: "Todo", icon: ShoppingBag },
    { value: "POLERA", label: "Poleras", icon: Shirt },
    { value: "GORRA", label: "Gorras", icon: Tag },
    { value: "PIN", label: "Pines", icon: Tag },
]

export function MerchCatalog({ products }: MerchCatalogProps) {
    const [zoneFilter, setZoneFilter] = useState<ZoneFilter>("ALL")
    const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL")
    const [openProduct, setOpenProduct] = useState<MerchProductView | null>(null)

    const filtered = useMemo(() => {
        return products.filter((p) => {
            if (zoneFilter !== "ALL" && p.zone !== zoneFilter) return false
            if (categoryFilter !== "ALL" && p.category !== categoryFilter) return false
            return true
        })
    }, [products, zoneFilter, categoryFilter])

    const groupedByCategory = useMemo(() => {
        const groups: Record<MerchCategory, MerchProductView[]> = {
            POLERA: [],
            GORRA: [],
            PIN: [],
            OTROS: [],
        }
        for (const product of filtered) {
            groups[product.category].push(product)
        }
        return groups
    }, [filtered])

    return (
        <>
            {/* Filters */}
            <div className="mb-8 space-y-4">
                <div className="flex flex-wrap gap-2">
                    {CATEGORY_FILTERS.map((filter) => {
                        const Icon = filter.icon
                        const active = categoryFilter === filter.value
                        return (
                            <button
                                key={filter.value}
                                type="button"
                                onClick={() => setCategoryFilter(filter.value)}
                                className={cn(
                                    "inline-flex items-center gap-1.5 h-10 px-4 rounded-full text-sm font-semibold border-2 transition-all",
                                    active
                                        ? "bg-fdnda-primary text-white border-fdnda-primary shadow-md"
                                        : "bg-white text-foreground border-border hover:border-fdnda-primary"
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                {filter.label}
                            </button>
                        )
                    })}
                </div>

                <div className="flex flex-wrap gap-2">
                    {ZONE_FILTERS.map((filter) => {
                        const active = zoneFilter === filter.value
                        const theme = filter.value !== "ALL" ? ZONE_THEME[filter.value] : null
                        return (
                            <button
                                key={filter.value}
                                type="button"
                                onClick={() => setZoneFilter(filter.value)}
                                className={cn(
                                    "h-9 px-3.5 rounded-full text-xs font-semibold border-2 transition-all",
                                    active
                                        ? theme
                                            ? cn(theme.badge, "border-transparent shadow-md")
                                            : "bg-foreground text-white border-foreground"
                                        : "bg-white text-foreground border-border hover:border-fdnda-secondary"
                                )}
                            >
                                {filter.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            {/* Grid grouped by category */}
            {filtered.length === 0 ? (
                <EmptyState
                    variant="generic"
                    title="No hay productos disponibles"
                    description="Pronto vamos a publicar más merch oficial. ¡Vuelve a revisar!"
                />
            ) : (
                <div className="space-y-12">
                    {(Object.keys(groupedByCategory) as MerchCategory[]).map((category) => {
                        const list = groupedByCategory[category]
                        if (list.length === 0) return null
                        return (
                            <section key={category}>
                                {categoryFilter === "ALL" && (
                                    <h3 className="font-display text-2xl sm:text-3xl font-bold text-foreground mb-5">
                                        {CATEGORY_LABEL[category]}
                                    </h3>
                                )}
                                <motion.div
                                    initial="hidden"
                                    animate="visible"
                                    variants={{
                                        visible: { transition: { staggerChildren: 0.06 } },
                                    }}
                                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
                                >
                                    {list.map((product, idx) => (
                                        <motion.div
                                            key={product.id}
                                            variants={{
                                                hidden: { opacity: 0, y: 16 },
                                                visible: { opacity: 1, y: 0 },
                                            }}
                                            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                                        >
                                            <MerchProductCard
                                                product={product}
                                                onOpen={setOpenProduct}
                                                priority={idx < 4}
                                            />
                                        </motion.div>
                                    ))}
                                </motion.div>
                            </section>
                        )
                    })}
                </div>
            )}

            <MerchProductModal product={openProduct} onClose={() => setOpenProduct(null)} />
        </>
    )
}
