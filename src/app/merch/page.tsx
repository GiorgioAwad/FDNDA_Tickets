import { prisma } from "@/lib/prisma"
import { Badge } from "@/components/ui/badge"
import { Sparkles } from "lucide-react"
import { MerchCatalog } from "@/components/merch/MerchCatalog"
import type { MerchProductView } from "@/components/merch/types"

export const metadata = {
    title: "Merch Oficial · FDNDA",
    description:
        "Poleras, gorras y pines oficiales del Campeonato Descentralizado FDNDA. Apoya tu zona: Lima, Sur, Norte u Oriente.",
}

export const revalidate = 60
export const dynamic = "force-dynamic"

async function getProducts(): Promise<MerchProductView[]> {
    try {
        const products = await prisma.merchProduct.findMany({
            where: { isActive: true },
            include: {
                variants: {
                    where: { isActive: true },
                    orderBy: { size: "asc" },
                },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        })

        return products.map((product) => {
            const variants = product.variants.map((variant) => ({
                id: variant.id,
                size: variant.size,
                sku: variant.sku,
                available: Math.max(0, variant.stock - variant.reserved - variant.sold),
            }))
            const totalAvailable = variants.reduce((sum, v) => sum + v.available, 0)
            const imageUrls = Array.isArray(product.imageUrls)
                ? product.imageUrls.filter((u): u is string => typeof u === "string")
                : []
            const availableSizes = Array.isArray(product.availableSizes)
                ? product.availableSizes.filter((s): s is string => typeof s === "string")
                : []

            return {
                id: product.id,
                slug: product.slug,
                name: product.name,
                description: product.description,
                category: product.category as MerchProductView["category"],
                zone: product.zone as MerchProductView["zone"],
                etapa: product.etapa,
                price: Number(product.price),
                currency: product.currency,
                imageUrl: product.imageUrl,
                imageUrls,
                hasSizes: product.hasSizes,
                availableSizes,
                isSoldOut: totalAvailable === 0,
                variants,
            }
        })
    } catch (error) {
        console.error("Failed to load merch products", error)
        return []
    }
}

export default async function MerchPage() {
    const products = await getProducts()

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
            {/* Hero */}
            <section className="relative overflow-hidden bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-accent text-white py-14 sm:py-20">
                <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-coral/30 blur-3xl" aria-hidden />
                <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" aria-hidden />
                <div className="relative container mx-auto px-4 text-center max-w-3xl">
                    <Badge variant="info" className="mb-4 bg-white/20 text-white border-white/30 backdrop-blur-sm">
                        <Sparkles className="h-3 w-3 mr-1" />
                        Edición Campeonato Descentralizado
                    </Badge>
                    <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold mb-4">
                        Merch Oficial FDNDA
                    </h1>
                    <p className="text-white/85 text-base sm:text-lg max-w-xl mx-auto">
                        Lleva la camiseta de tu zona. Poleras, gorras y pines oficiales del Campeonato Descentralizado de Natación FDNDA 2026.
                    </p>

                    <div className="mt-8 inline-flex flex-wrap gap-3 justify-center text-sm font-semibold">
                        <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-4 py-1.5">
                            Pines · S/ 10
                        </span>
                        <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-4 py-1.5">
                            Gorras · S/ 20
                        </span>
                        <span className="inline-flex items-center gap-1.5 bg-white/15 backdrop-blur-sm rounded-full px-4 py-1.5">
                            Poleras · S/ 80
                        </span>
                    </div>
                </div>
            </section>

            {/* Catalog */}
            <section className="py-12 sm:py-16">
                <div className="container mx-auto px-4">
                    <MerchCatalog products={products} />
                </div>
            </section>
        </div>
    )
}
