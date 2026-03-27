import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { buildStoredAssetKey, deleteAsset, getStorageProvider, uploadAsset } from "@/lib/storage"
import { rateLimit, getClientIP } from "@/lib/rate-limit"

export const runtime = "nodejs"

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_FILE_SIZE = 5 * 1024 * 1024

export const BANNER_DIMENSIONS = {
    width: 1200,
    height: 630,
    aspectRatio: "1200:630",
}

async function requireAdminUser() {
    const user = await getCurrentUser()

    if (!user || !hasRole(user.role, "ADMIN")) {
        return null
    }

    return user
}

export async function POST(request: NextRequest) {
    try {
        // Rate limiting for uploads
        const ip = getClientIP(request)
        const { success: rateLimitOk } = await rateLimit(ip, "api")
        if (!rateLimitOk) {
            return NextResponse.json(
                { success: false, error: "Demasiados intentos. Intenta de nuevo en un minuto." },
                { status: 429 }
            )
        }

        const user = await requireAdminUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const formData = await request.formData()
        const file = formData.get("file") as File | null
        const type = formData.get("type") as string | null

        if (!file) {
            return NextResponse.json(
                { success: false, error: "No se proporciono archivo" },
                { status: 400 }
            )
        }

        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Tipo de archivo no permitido. Usa: ${ALLOWED_TYPES.map((item) => item.split("/")[1]).join(", ")}`,
                },
                { status: 400 }
            )
        }

        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                {
                    success: false,
                    error: `El archivo es muy grande. Maximo: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
                },
                { status: 400 }
            )
        }

        const key = buildStoredAssetKey(type, file.name)
        const buffer = Buffer.from(await file.arrayBuffer())
        const storedAsset = await uploadAsset({
            key,
            buffer,
            contentType: file.type,
            size: file.size,
        })

        let assetRecord

        try {
            assetRecord = await prisma.uploadedAsset.create({
                data: {
                    provider: storedAsset.provider,
                    kind: type || "image",
                    key: storedAsset.key,
                    url: storedAsset.url,
                    contentType: storedAsset.contentType,
                    size: storedAsset.size,
                    createdById: user.id,
                },
            })
        } catch (error) {
            await deleteAsset(storedAsset).catch(() => {})
            throw error
        }

        return NextResponse.json({
            success: true,
            assetId: assetRecord.id,
            provider: storedAsset.provider,
            key: storedAsset.key,
            url: storedAsset.url,
            filename: storedAsset.key,
            size: storedAsset.size,
            type: storedAsset.contentType,
            checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
            dimensions: type === "banner" ? BANNER_DIMENSIONS : undefined,
            storage: {
                provider: getStorageProvider(),
            },
        })
    } catch (error) {
        console.error("Upload error:", error)

        return NextResponse.json(
            { success: false, error: "Error al subir archivo" },
            { status: 500 }
        )
    }
}

export async function GET() {
    return NextResponse.json({
        success: true,
        allowedTypes: ALLOWED_TYPES,
        maxFileSize: MAX_FILE_SIZE,
        maxFileSizeMB: MAX_FILE_SIZE / 1024 / 1024,
        storageProvider: getStorageProvider(),
        bannerRecommendations: {
            ...BANNER_DIMENSIONS,
            description: "Tamano recomendado para banners de eventos",
            tips: [
                "Usa imagenes de alta calidad (minimo 1200x630px)",
                "Formato recomendado: JPG o WebP para mejor compresion",
                "Evita texto pequeno que no se lea en moviles",
                "Deja espacio para el titulo del evento superpuesto",
            ],
        },
    })
}

export async function DELETE(request: NextRequest) {
    try {
        const user = await requireAdminUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { url, assetId } = await request.json()

        if (!url && !assetId) {
            return NextResponse.json(
                { success: false, error: "URL o assetId requeridos" },
                { status: 400 }
            )
        }

        const asset = assetId
            ? await prisma.uploadedAsset.findUnique({ where: { id: assetId } })
            : await prisma.uploadedAsset.findUnique({ where: { url } })

        if (asset) {
            await deleteAsset({
                provider: asset.provider as "r2" | "blob" | "local",
                key: asset.key,
                url: asset.url,
            })

            await prisma.uploadedAsset.delete({
                where: { id: asset.id },
            })
        } else if (url) {
            await deleteAsset({ url })
        }

        return NextResponse.json({
            success: true,
            message: "Archivo eliminado correctamente",
        })
    } catch (error) {
        console.error("Delete error:", error)
        return NextResponse.json(
            { success: false, error: "Error al eliminar archivo" },
            { status: 500 }
        )
    }
}
