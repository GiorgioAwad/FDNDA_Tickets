import { notFound } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { MerchProductForm } from "@/components/admin/MerchProductForm"
import { MerchVariantManager, type MerchVariantRow } from "@/components/admin/MerchVariantManager"

export const dynamic = "force-dynamic"

interface AdminMerchEditPageProps {
    params: Promise<{ id: string }>
}

export default async function AdminMerchEditPage({ params }: AdminMerchEditPageProps) {
    const { id } = await params

    const product = await prisma.merchProduct.findUnique({
        where: { id },
        include: {
            variants: { orderBy: { size: "asc" } },
        },
    })

    if (!product) notFound()

    const availableSizes = Array.isArray(product.availableSizes)
        ? (product.availableSizes as unknown[]).filter((s): s is string => typeof s === "string")
        : []

    const imageUrls = Array.isArray(product.imageUrls)
        ? (product.imageUrls as unknown[]).filter((u): u is string => typeof u === "string")
        : []

    const variantRows: MerchVariantRow[] = product.variants.map((v) => ({
        id: v.id,
        size: v.size,
        sku: v.sku,
        stock: v.stock,
        reserved: v.reserved,
        sold: v.sold,
        available: Math.max(0, v.stock - v.reserved - v.sold),
        isActive: v.isActive,
    }))

    return (
        <div className="p-6 max-w-7xl mx-auto space-y-6">
            <div>
                <Link
                    href="/admin/merch"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver
                </Link>
                <h1 className="font-display text-3xl font-bold text-foreground">{product.name}</h1>
                <p className="text-sm text-muted-foreground mt-1 font-mono">/merch/{product.slug}</p>
            </div>

            <MerchProductForm
                isEdit
                initialData={{
                    id: product.id,
                    name: product.name,
                    description: product.description ?? "",
                    category: product.category,
                    zone: product.zone,
                    etapa: product.etapa ?? "",
                    price: Number(product.price),
                    imageUrl: product.imageUrl ?? "",
                    imageUrls,
                    backImageUrl: imageUrls[0] ?? "",
                    hasSizes: product.hasSizes,
                    availableSizes,
                    isActive: product.isActive,
                    sortOrder: product.sortOrder,
                    servilexServiceCode: product.servilexServiceCode,
                    servilexSucursalCode: product.servilexSucursalCode,
                }}
            />

            <MerchVariantManager productId={product.id} initialVariants={variantRows} />
        </div>
    )
}
