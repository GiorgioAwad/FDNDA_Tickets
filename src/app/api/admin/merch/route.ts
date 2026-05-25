import { NextRequest, NextResponse } from "next/server"
import slugify from "slugify"
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

// GET /api/admin/merch - List all (active + inactive)
export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const products = await prisma.merchProduct.findMany({
            include: {
                variants: { orderBy: { size: "asc" } },
                servilexService: { select: { id: true, codigo: true, descripcion: true } },
                _count: { select: { variants: true } },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
        })

        const data = products.map((p) => ({
            ...p,
            price: Number(p.price),
            variants: p.variants.map((v) => ({
                ...v,
                available: Math.max(0, v.stock - v.reserved - v.sold),
            })),
        }))

        return NextResponse.json({ success: true, data })
    } catch (error) {
        console.error("Error fetching merch products:", error)
        return NextResponse.json({ success: false, error: "Error al obtener productos" }, { status: 500 })
    }
}

// POST /api/admin/merch - Create product (with auto variants)
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()
        const {
            name,
            description,
            category,
            zone = "GENERICA",
            etapa,
            price,
            imageUrl,
            hasSizes = false,
            availableSizes,
            initialStock,
            isActive = true,
            sortOrder = 0,
            servilexServiceId,
        } = body

        if (typeof name !== "string" || !name.trim()) {
            return NextResponse.json({ success: false, error: "Nombre requerido" }, { status: 400 })
        }
        if (!isMerchCategory(category)) {
            return NextResponse.json({ success: false, error: "Categoría inválida" }, { status: 400 })
        }
        if (!isMerchZone(zone)) {
            return NextResponse.json({ success: false, error: "Zona inválida" }, { status: 400 })
        }
        const priceNum = Number(price)
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
            return NextResponse.json({ success: false, error: "Precio inválido" }, { status: 400 })
        }

        const sizesArray = hasSizes ? normalizeSizes(availableSizes) : []
        if (hasSizes && sizesArray.length === 0) {
            return NextResponse.json({ success: false, error: "Debes indicar al menos una talla" }, { status: 400 })
        }

        // Unique slug
        let slug = slugify(name, { lower: true, strict: true })
        let count = 0
        while (await prisma.merchProduct.findUnique({ where: { slug } })) {
            count++
            slug = `${slugify(name, { lower: true, strict: true })}-${count}`
        }

        const stockBase = Number(initialStock)
        const stockPerVariant = Number.isFinite(stockBase) && stockBase >= 0 ? Math.floor(stockBase) : 0
        const skuSuffix = Math.random().toString(36).slice(2, 6).toUpperCase()

        const variantsData = hasSizes
            ? sizesArray.map((size) => ({
                size,
                sku: buildSku(category, zone, size, skuSuffix),
                stock: stockPerVariant,
            }))
            : [
                {
                    size: null,
                    sku: buildSku(category, zone, null, skuSuffix),
                    stock: stockPerVariant,
                },
            ]

        const product = await prisma.merchProduct.create({
            data: {
                slug,
                name: name.trim(),
                description: typeof description === "string" ? description : null,
                category,
                zone,
                etapa: typeof etapa === "string" && etapa.trim() ? etapa.trim() : null,
                price: priceNum,
                imageUrl: typeof imageUrl === "string" && imageUrl ? imageUrl : null,
                hasSizes,
                availableSizes: hasSizes ? (sizesArray as Prisma.InputJsonValue) : Prisma.JsonNull,
                isActive: Boolean(isActive),
                sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
                servilexServiceId: typeof servilexServiceId === "string" && servilexServiceId ? servilexServiceId : null,
                variants: { create: variantsData },
            },
            include: { variants: true },
        })

        return NextResponse.json({ success: true, data: product })
    } catch (error) {
        console.error("Error creating merch product:", error)
        return NextResponse.json({ success: false, error: "Error al crear producto" }, { status: 500 })
    }
}
