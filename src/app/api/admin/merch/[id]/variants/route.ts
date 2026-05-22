import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

// PATCH /api/admin/merch/[id]/variants - Bulk update stock/isActive per variant
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { id } = await context.params
        const body = await request.json()

        if (!Array.isArray(body.updates)) {
            return NextResponse.json({ success: false, error: "Payload inválido" }, { status: 400 })
        }

        const updates = body.updates as Array<{ variantId: string; stock?: number; isActive?: boolean }>

        const product = await prisma.merchProduct.findUnique({
            where: { id },
            include: { variants: { select: { id: true } } },
        })
        if (!product) {
            return NextResponse.json({ success: false, error: "Producto no encontrado" }, { status: 404 })
        }

        const variantIds = new Set(product.variants.map((v) => v.id))

        await prisma.$transaction(async (tx) => {
            for (const update of updates) {
                if (!variantIds.has(update.variantId)) continue
                const data: { stock?: number; isActive?: boolean } = {}
                if (typeof update.stock === "number" && Number.isFinite(update.stock) && update.stock >= 0) {
                    data.stock = Math.floor(update.stock)
                }
                if (typeof update.isActive === "boolean") {
                    data.isActive = update.isActive
                }
                if (Object.keys(data).length === 0) continue
                await tx.merchVariant.update({ where: { id: update.variantId }, data })
            }
        })

        const refreshed = await prisma.merchVariant.findMany({
            where: { productId: id },
            orderBy: { size: "asc" },
        })

        return NextResponse.json({
            success: true,
            data: refreshed.map((v) => ({
                ...v,
                available: Math.max(0, v.stock - v.reserved - v.sold),
            })),
        })
    } catch (error) {
        console.error("Error updating variants:", error)
        return NextResponse.json({ success: false, error: "Error al actualizar variantes" }, { status: 500 })
    }
}
