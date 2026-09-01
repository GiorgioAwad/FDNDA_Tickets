import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveMerchPickupAssignments } from "@/lib/merch-pickup"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
    try {
        const productIdsParam = request.nextUrl.searchParams.get("productIds")
        if (productIdsParam !== null) {
            const productIds = Array.from(
                new Set(
                    productIdsParam
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean)
                )
            ).slice(0, 20)

            const products = await prisma.merchProduct.findMany({
                where: { id: { in: productIds } },
                select: {
                    id: true,
                    isActive: true,
                    pickupLocationId: true,
                    pickupLocation: {
                        select: {
                            id: true,
                            name: true,
                            address: true,
                            district: true,
                            instructions: true,
                            isActive: true,
                        },
                    },
                },
            })
            const productsById = new Map(products.map((product) => [product.id, product]))
            const resolution = resolveMerchPickupAssignments(
                productIds.map((productId) => {
                    const product = productsById.get(productId)
                    return {
                        productId,
                        pickupLocationId: product?.pickupLocationId ?? null,
                        pickupLocationIsActive: Boolean(product?.isActive && product.pickupLocation.isActive),
                    }
                })
            )

            const locations = Array.from(
                new Map(
                    products
                        .filter((product) => product.isActive && product.pickupLocation.isActive)
                        .map((product) => [product.pickupLocation.id, product.pickupLocation])
                ).values()
            )

            return NextResponse.json(
                { success: true, data: locations, resolution },
                { headers: { "Cache-Control": "no-store" } }
            )
        }

        const locations = await prisma.merchPickupLocation.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            select: {
                id: true,
                name: true,
                address: true,
                district: true,
                instructions: true,
            },
        })

        return NextResponse.json(
            { success: true, data: locations },
            { headers: { "Cache-Control": "no-store" } }
        )
    } catch (error) {
        console.error("Error fetching merch pickup locations:", error)
        return NextResponse.json(
            { success: false, error: "No se pudieron cargar las sedes de recojo." },
            { status: 500 }
        )
    }
}
