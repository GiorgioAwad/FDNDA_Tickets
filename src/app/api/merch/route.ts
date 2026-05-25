import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
const PUBLIC_CACHE_CONTROL = "public, s-maxage=30, stale-while-revalidate=120"

// GET /api/merch - List active merch products grouped by category
export async function GET() {
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

        const data = products.map((product) => {
            const variants = product.variants.map((variant) => ({
                id: variant.id,
                size: variant.size,
                sku: variant.sku,
                available: Math.max(0, variant.stock - variant.reserved - variant.sold),
            }))
            const totalAvailable = variants.reduce((sum, v) => sum + v.available, 0)

            return {
                id: product.id,
                slug: product.slug,
                name: product.name,
                description: product.description,
                category: product.category,
                zone: product.zone,
                etapa: product.etapa,
                price: Number(product.price),
                currency: product.currency,
                imageUrl: product.imageUrl,
                imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
                hasSizes: product.hasSizes,
                availableSizes: Array.isArray(product.availableSizes) ? product.availableSizes : [],
                isSoldOut: totalAvailable === 0,
                variants,
            }
        })

        return NextResponse.json(
            { success: true, data },
            { headers: { "Cache-Control": PUBLIC_CACHE_CONTROL } }
        )
    } catch (error) {
        console.error("Error fetching merch products:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener productos" },
            { status: 500 }
        )
    }
}
