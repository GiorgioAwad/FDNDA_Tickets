/**
 * Seed inicial de productos de merch del Campeonato Descentralizado.
 *
 * Lee R2_PUBLIC_BASE_URL del entorno y construye las URLs apuntando a
 * <BASE>/merch/<nombre>.png (mismos nombres que ya tienes en el bucket).
 *
 * Uso:
 *   npx tsx scripts/seed-merch.ts
 *
 * Idempotente: si un slug ya existe, actualiza imageUrl/precio/stock; no duplica.
 */

import { PrismaClient, MerchCategory, MerchZone } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
    console.error("[ERROR] DATABASE_URL no está seteado en el entorno.")
    process.exit(1)
}

const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "")
if (!PUBLIC_BASE) {
    console.error("[ERROR] R2_PUBLIC_BASE_URL no está seteado en el entorno.")
    process.exit(1)
}

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

interface SeedProduct {
    slug: string
    name: string
    category: MerchCategory
    zone: MerchZone
    etapa: string
    price: number
    hasSizes: boolean
    availableSizes: string[] | null
    initialStockPerVariant: number
    imageFile: string             // nombre del archivo en R2 dentro de /merch/ (frente)
    backImageFile?: string        // opcional — solo POLERA (espalda)
}

const POLERA_SIZES = ["S", "M", "L", "XL"]

// Convención de archivos en el bucket assets.ticketingfdnda.pe/merch/:
//   MERCH-OFICIAL_<Zona> hoodie-1.png   → espalda de la polera
//   MERCH-OFICIAL_<Zona> hoodie-2.png   → frente de la polera
//   MERCH-OFICIAL_<Zona> gorra.png
//   MERCH-OFICIAL_<Zona> Pin.png
const PRODUCTS: SeedProduct[] = [
    // ===== POLERAS (S/80) =====
    {
        slug: "polera-oficial-lima",
        name: "Polera Oficial — Zona 1 Lima",
        category: "POLERA",
        zone: "LIMA",
        etapa: "1-A",
        price: 80,
        hasSizes: true,
        availableSizes: POLERA_SIZES,
        initialStockPerVariant: 30,
        imageFile: "MERCH-OFICIAL_Lima hoodie-2.png",
        backImageFile: "MERCH-OFICIAL_Lima hoodie-1.png",
    },
    {
        slug: "polera-oficial-norte",
        name: "Polera Oficial — Zona 3 Norte",
        category: "POLERA",
        zone: "NORTE",
        etapa: "1-A",
        price: 80,
        hasSizes: true,
        availableSizes: POLERA_SIZES,
        initialStockPerVariant: 30,
        imageFile: "MERCH-OFICIAL_Norte hoodie-2.png",
        backImageFile: "MERCH-OFICIAL_Norte hoodie-1.png",
    },
    {
        slug: "polera-oficial-sur",
        name: "Polera Oficial — Zona 2 Sur",
        category: "POLERA",
        zone: "SUR",
        etapa: "1-B",
        price: 80,
        hasSizes: true,
        availableSizes: POLERA_SIZES,
        initialStockPerVariant: 30,
        imageFile: "MERCH-OFICIAL_Sur hoodie-2.png",
        backImageFile: "MERCH-OFICIAL_Sur hoodie-1.png",
    },
    {
        slug: "polera-oficial-oriente",
        name: "Polera Oficial — Zona 4 Oriente",
        category: "POLERA",
        zone: "ORIENTE",
        etapa: "1-B",
        price: 80,
        hasSizes: true,
        availableSizes: POLERA_SIZES,
        initialStockPerVariant: 30,
        imageFile: "MERCH-OFICIAL_Oriente hoodie-2.png",
        backImageFile: "MERCH-OFICIAL_Oriente hoodie-1.png",
    },

    // ===== GORRAS (S/20) =====
    {
        slug: "gorra-oficial-lima",
        name: "Gorra Oficial — Zona 1 Lima",
        category: "GORRA",
        zone: "LIMA",
        etapa: "1-A",
        price: 20,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 50,
        imageFile: "MERCH-OFICIAL_Lima gorra.png",
    },
    {
        slug: "gorra-oficial-norte",
        name: "Gorra Oficial — Zona 3 Norte",
        category: "GORRA",
        zone: "NORTE",
        etapa: "1-A",
        price: 20,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 50,
        imageFile: "MERCH-OFICIAL_Norte gorra.png",
    },
    {
        slug: "gorra-oficial-sur",
        name: "Gorra Oficial — Zona 2 Sur",
        category: "GORRA",
        zone: "SUR",
        etapa: "1-B",
        price: 20,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 50,
        imageFile: "MERCH-OFICIAL_Sur gorra.png",
    },
    {
        slug: "gorra-oficial-oriente",
        name: "Gorra Oficial — Zona 4 Oriente",
        category: "GORRA",
        zone: "ORIENTE",
        etapa: "1-B",
        price: 20,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 50,
        imageFile: "MERCH-OFICIAL_Oriente gorra.png",
    },

    // ===== PINES (S/10) =====
    {
        slug: "pin-oficial-lima",
        name: "Pin Oficial — Zona 1 Lima",
        category: "PIN",
        zone: "LIMA",
        etapa: "1-A",
        price: 10,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 100,
        imageFile: "MERCH-OFICIAL_Lima Pin.png",
    },
    {
        slug: "pin-oficial-norte",
        name: "Pin Oficial — Zona 3 Norte",
        category: "PIN",
        zone: "NORTE",
        etapa: "1-A",
        price: 10,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 100,
        imageFile: "MERCH-OFICIAL_Norte Pin.png",
    },
    {
        slug: "pin-oficial-sur",
        name: "Pin Oficial — Zona 2 Sur",
        category: "PIN",
        zone: "SUR",
        etapa: "1-B",
        price: 10,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 100,
        imageFile: "MERCH-OFICIAL_Sur Pin.png",
    },
    {
        slug: "pin-oficial-oriente",
        name: "Pin Oficial — Zona 4 Oriente",
        category: "PIN",
        zone: "ORIENTE",
        etapa: "1-B",
        price: 10,
        hasSizes: false,
        availableSizes: null,
        initialStockPerVariant: 100,
        imageFile: "MERCH-OFICIAL_Oriente Pin.png",
    },
]

function buildSku(category: MerchCategory, zone: MerchZone, size: string | null, suffix: string): string {
    const cat = category.slice(0, 3)
    const zon = zone === "GENERICA" ? "GEN" : zone.slice(0, 3)
    const siz = size || "UNI"
    return `${cat}-${zon}-${siz}-${suffix}`
}

async function main() {
    console.log(`[seed-merch] Base URL: ${PUBLIC_BASE}`)
    let created = 0
    let updated = 0

    for (const [index, product] of PRODUCTS.entries()) {
        const imageUrl = `${PUBLIC_BASE}/merch/${encodeURIComponent(product.imageFile)}`
        const backImageUrl = product.backImageFile
            ? `${PUBLIC_BASE}/merch/${encodeURIComponent(product.backImageFile)}`
            : null
        const imageUrls = backImageUrl ? [backImageUrl] : []
        const sortOrder = (PRODUCTS.length - index) * 10  // poleras primero

        const existing = await prisma.merchProduct.findUnique({ where: { slug: product.slug } })

        if (existing) {
            await prisma.merchProduct.update({
                where: { slug: product.slug },
                data: {
                    name: product.name,
                    category: product.category,
                    zone: product.zone,
                    etapa: product.etapa,
                    price: product.price,
                    imageUrl,
                    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                    hasSizes: product.hasSizes,
                    availableSizes: product.availableSizes ?? undefined,
                    isActive: true,
                    sortOrder,
                },
            })
            updated++
            console.log(`[~] ${product.slug}: imágenes actualizadas (${imageUrls.length > 0 ? "frente + espalda" : "frente"})`)
            continue
        }

        const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
        const variantsData = product.hasSizes
            ? (product.availableSizes || []).map((size) => ({
                size,
                sku: buildSku(product.category, product.zone, size, suffix),
                stock: product.initialStockPerVariant,
            }))
            : [
                {
                    size: null,
                    sku: buildSku(product.category, product.zone, null, suffix),
                    stock: product.initialStockPerVariant,
                },
            ]

        await prisma.merchProduct.create({
            data: {
                slug: product.slug,
                name: product.name,
                category: product.category,
                zone: product.zone,
                etapa: product.etapa,
                price: product.price,
                imageUrl,
                imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
                hasSizes: product.hasSizes,
                availableSizes: product.availableSizes ?? undefined,
                isActive: true,
                sortOrder,
                variants: { create: variantsData },
            },
        })
        created++
        console.log(`[+] ${product.slug}: creado con ${variantsData.length} variante(s)`)
    }

    console.log(`\nResumen: ${created} creados, ${updated} actualizados`)
}

main()
    .catch((error) => {
        console.error("[seed-merch] Error:", error)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
