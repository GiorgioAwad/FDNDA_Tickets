import Link from "next/link"
import Image from "next/image"
import { prisma } from "@/lib/prisma"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { formatPrice } from "@/lib/utils"
import { Plus, Pencil, Package, ShoppingBag } from "lucide-react"

export const dynamic = "force-dynamic"

const ZONE_LABELS: Record<string, string> = {
    LIMA: "Lima",
    SUR: "Sur",
    NORTE: "Norte",
    ORIENTE: "Oriente",
    GENERICA: "General",
}

const CATEGORY_LABELS: Record<string, string> = {
    POLERA: "Polera",
    GORRA: "Gorra",
    PIN: "Pin",
    OTROS: "Otros",
}

async function getProducts() {
    return prisma.merchProduct.findMany({
        include: {
            variants: true,
            _count: { select: { variants: true } },
        },
        orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    })
}

export default async function AdminMerchPage() {
    const products = await getProducts()

    const totalActive = products.filter((p) => p.isActive).length
    const totalStock = products.reduce(
        (sum, p) => sum + p.variants.reduce((s, v) => s + Math.max(0, v.stock - v.reserved - v.sold), 0),
        0
    )
    const totalSold = products.reduce(
        (sum, p) => sum + p.variants.reduce((s, v) => s + v.sold, 0),
        0
    )

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl font-bold text-foreground">Merch</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Gestiona productos físicos del campeonato: poleras, gorras, pines.
                    </p>
                </div>
                <Link href="/admin/merch/nuevo">
                    <Button>
                        <Plus className="h-4 w-4" />
                        Nuevo producto
                    </Button>
                </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-border p-4">
                    <div className="text-xs uppercase text-muted-foreground font-semibold">Productos activos</div>
                    <div className="text-2xl font-display font-bold text-foreground mt-1">{totalActive}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                    <div className="text-xs uppercase text-muted-foreground font-semibold">Stock disponible</div>
                    <div className="text-2xl font-display font-bold text-foreground mt-1">{totalStock}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                    <div className="text-xs uppercase text-muted-foreground font-semibold">Unidades vendidas</div>
                    <div className="text-2xl font-display font-bold text-fdnda-primary mt-1">{totalSold}</div>
                </div>
            </div>

            {products.length === 0 ? (
                <EmptyState
                    variant="generic"
                    title="Aún no hay productos"
                    description="Crea tu primer producto de merch para empezar a vender."
                    action={{ label: "Crear producto", href: "/admin/merch/nuevo" }}
                />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {products.map((product) => {
                        const stock = product.variants.reduce((s, v) => s + Math.max(0, v.stock - v.reserved - v.sold), 0)
                        const sold = product.variants.reduce((s, v) => s + v.sold, 0)
                        return (
                            <Link
                                key={product.id}
                                href={`/admin/merch/${product.id}`}
                                className="group block rounded-xl border border-border bg-white overflow-hidden hover:shadow-card-hover transition-shadow"
                            >
                                <div className="relative aspect-[3/4] bg-gray-100 overflow-hidden">
                                    {product.imageUrl ? (
                                        <Image
                                            src={product.imageUrl}
                                            alt={product.name}
                                            fill
                                            sizes="(min-width: 1024px) 33vw, 50vw"
                                            className="object-contain p-3 group-hover:scale-105 transition-transform"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                            <Package className="h-12 w-12" />
                                        </div>
                                    )}
                                    {!product.isActive && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                            <Badge className="bg-white text-foreground font-bold">Inactivo</Badge>
                                        </div>
                                    )}
                                </div>
                                <div className="p-4 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant="outline" className="font-semibold">
                                            {CATEGORY_LABELS[product.category]}
                                        </Badge>
                                        {product.zone !== "GENERICA" && (
                                            <Badge variant="outline" className="font-semibold">
                                                Zona {ZONE_LABELS[product.zone]}
                                            </Badge>
                                        )}
                                        {product.etapa && (
                                            <Badge variant="outline" className="font-semibold">
                                                Etapa {product.etapa}
                                            </Badge>
                                        )}
                                    </div>
                                    <h3 className="font-semibold text-foreground line-clamp-1">{product.name}</h3>
                                    <div className="flex items-center justify-between text-sm">
                                        <span className="font-display font-bold text-fdnda-primary text-lg">
                                            {formatPrice(Number(product.price))}
                                        </span>
                                        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                                            <ShoppingBag className="h-3 w-3" /> {sold} vendidos · {stock} stock
                                        </span>
                                    </div>
                                    <div className="pt-2 flex items-center gap-1 text-xs text-fdnda-secondary font-semibold group-hover:translate-x-0.5 transition-transform">
                                        <Pencil className="h-3 w-3" />
                                        Editar
                                    </div>
                                </div>
                            </Link>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
