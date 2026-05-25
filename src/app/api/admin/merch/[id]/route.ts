import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { MerchCategory, MerchZone, Prisma } from "@prisma/client"

export const runtime = "nodejs"

const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "XXXL", "UNI"]

function normalizeSizes(input: unknown): string[] {
    if (!Array.isArray(input)) return []
    const cleaned = input
        .map((v) => (typeof v === "string" ? v.trim().toUpperCase() : ""))
        .filter((v) => v.length > 0 && v.length <= 8)
    return Array.from(new Set(cleaned)).sort((a, b) => {
        const ai = SIZE_ORDER.indexOf(a)
        const bi = SIZE_ORDER.indexOf(b)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.localeCompare(b)
    })
}

function buildSku(category: MerchCategory, zone: MerchZone, size: string | null, suffix: string): string {
    const cat = category.slice(0, 3)
    const zon = zone === "GENERICA" ? "GEN" : zone.slice(0, 3)
    const siz = size || "UNI"
    return `${cat}-${zon}-${siz}-${suffix}`
}

function isMerchCategory(value: unknown): value is MerchCategory {
    return value === "POLERA" || value === "GORRA" || value === "PIN" || value === "OTROS"
}

function isMerchZone(value: unknown): value is MerchZone {
    return value === "LIMA" || value === "SUR" || value === "NORTE" || value === "ORIENTE" || value === "GENERICA"
}

// GET /api/admin/merch/[id]
export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await context.params
        const product = await prisma.merchProduct.findUnique({
            where: { id },
            include: {
                variants: { orderBy: { size: "asc" } },
                servilexService: true,
            },
        })

        if (!product) {
            return NextResponse.json({ success: false, error: "Producto no encontrado" }, { status: 404 })
        }

        return NextResponse.json({
            success: true,
            data: {
                ...product,
                price: Number(product.price),
                variants: product.variants.map((v) => ({
                    ...v,
                    available: Math.max(0, v.stock - v.reserved - v.sold),
                })),
            },
        })
    } catch (error) {
        console.error("Error fetching merch product:", error)
        return NextResponse.json({ success: false, error: "Error al obtener producto" }, { status: 500 })
    }
}

// PATCH /api/admin/merch/[id]
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await context.params
        const body = await request.json()

        const existing = await prisma.merchProduct.findUnique({
            where: { id },
            include: { variants: true },
        })
        if (!existing) {
            return NextResponse.json({ success: false, error: "Producto no encontrado" }, { status: 404 })
        }

        const data: Prisma.MerchProductUpdateInput = {}

        if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim()
        if (typeof body.description === "string" || body.description === null) data.description = body.description
        if (isMerchCategory(body.category)) data.category = body.category
        if (isMerchZone(body.zone)) data.zone = body.zone
        if (typeof body.etapa === "string" || body.etapa === null) data.etapa = body.etapa
        if (body.price !== undefined) {
            const n = Number(body.price)
            if (!Number.isFinite(n) || n <= 0) {
                return NextResponse.json({ success: false, error: "Precio inválido" }, { status: 400 })
            }
            data.price = n
        }
        if (typeof body.imageUrl === "string" || body.imageUrl === null) data.imageUrl = body.imageUrl
        if (typeof body.isActive === "boolean") data.isActive = body.isActive
        if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
            data.sortOrder = Number(body.sortOrder)
        }
        if (typeof body.servilexServiceId === "string" && body.servilexServiceId) {
            data.servilexService = { connect: { id: body.servilexServiceId } }
        } else if (body.servilexServiceId === null) {
            data.servilexService = { disconnect: true }
        }

        const newHasSizes = typeof body.hasSizes === "boolean" ? body.hasSizes : existing.hasSizes
        if (typeof body.hasSizes === "boolean") data.hasSizes = body.hasSizes

        let recreateVariants = false
        let nextSizes: string[] = []

        if (body.availableSizes !== undefined || typeof body.hasSizes === "boolean") {
            if (newHasSizes) {
                nextSizes = normalizeSizes(body.availableSizes ?? existing.availableSizes ?? [])
                if (nextSizes.length === 0) {
                    return NextResponse.json({ success: false, error: "Debes indicar al menos una talla" }, { status: 400 })
                }
                data.availableSizes = nextSizes as unknown as Prisma.InputJsonValue
                const currentSizes = existing.variants.map((v) => v.size).filter((s): s is string => s !== null).sort()
                const targetSorted = [...nextSizes].sort()
                if (currentSizes.join(",") !== targetSorted.join(",") || existing.variants.some((v) => v.size === null)) {
                    recreateVariants = true
                }
            } else {
                data.availableSizes = Prisma.JsonNull
                if (existing.hasSizes || existing.variants.some((v) => v.size !== null)) {
                    recreateVariants = true
                }
            }
        }

        const updated = await prisma.$transaction(async (tx) => {
            const product = await tx.merchProduct.update({ where: { id }, data })

            if (recreateVariants) {
                const hasSold = existing.variants.some((v) => v.sold > 0 || v.reserved > 0)
                if (hasSold) {
                    throw new Error("No se pueden recrear variantes: hay stock vendido o reservado. Ajusta tallas con cuidado o crea un producto nuevo.")
                }
                await tx.merchVariant.deleteMany({ where: { productId: id } })
                const skuSuffix = Math.random().toString(36).slice(2, 6).toUpperCase()
                const variantsData = newHasSizes
                    ? nextSizes.map((size) => ({
                        productId: id,
                        size,
                        sku: buildSku(product.category, product.zone, size, skuSuffix),
                        stock: 0,
                    }))
                    : [
                        {
                            productId: id,
                            size: null,
                            sku: buildSku(product.category, product.zone, null, skuSuffix),
                            stock: 0,
                        },
                    ]
                await tx.merchVariant.createMany({ data: variantsData })
            }

            return tx.merchProduct.findUnique({
                where: { id },
                include: { variants: { orderBy: { size: "asc" } } },
            })
        })

        return NextResponse.json({ success: true, data: updated })
    } catch (error) {
        console.error("Error updating merch product:", error)
        const message = error instanceof Error ? error.message : "Error al actualizar producto"
        return NextResponse.json({ success: false, error: message }, { status: 500 })
    }
}

// DELETE /api/admin/merch/[id]
export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await context.params

        const variants = await prisma.merchVariant.findMany({
            where: { productId: id },
            select: { id: true, sold: true, reserved: true },
        })
        const hasActivity = variants.some((v) => v.sold > 0 || v.reserved > 0)
        if (hasActivity) {
            // Soft-delete: marcar inactivo en vez de borrar
            await prisma.merchProduct.update({
                where: { id },
                data: { isActive: false },
            })
            return NextResponse.json({
                success: true,
                softDeleted: true,
                message: "Producto con historial de ventas. Marcado como inactivo.",
            })
        }

        await prisma.merchProduct.delete({ where: { id } })
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error("Error deleting merch product:", error)
        return NextResponse.json({ success: false, error: "Error al eliminar producto" }, { status: 500 })
    }
}
