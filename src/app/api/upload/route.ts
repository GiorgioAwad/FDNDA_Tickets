import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { getCurrentUser, hasRole } from "@/lib/auth"
import crypto from "crypto"

export const runtime = "nodejs"

// Allowed image types and max size
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"]
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

// Banner dimensions recommendation
export const BANNER_DIMENSIONS = {
    width: 1200,
    height: 630,
    aspectRatio: "1200:630", // 1.9:1 (similar to og:image)
}

/**
 * POST /api/upload - Upload an image file
 */
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const formData = await request.formData()
        const file = formData.get("file") as File | null
        const type = formData.get("type") as string | null // "banner", "logo", etc.

        if (!file) {
            return NextResponse.json(
                { success: false, error: "No se proporcionó archivo" },
                { status: 400 }
            )
        }

        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
            return NextResponse.json(
                { 
                    success: false, 
                    error: `Tipo de archivo no permitido. Usa: ${ALLOWED_TYPES.map(t => t.split('/')[1]).join(', ')}` 
                },
                { status: 400 }
            )
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            return NextResponse.json(
                { 
                    success: false, 
                    error: `El archivo es muy grande. Máximo: ${MAX_FILE_SIZE / 1024 / 1024}MB` 
                },
                { status: 400 }
            )
        }

        // Create upload directory if it doesn't exist
        const uploadDir = path.join(process.cwd(), "public", "uploads", type || "images")
        if (!existsSync(uploadDir)) {
            await mkdir(uploadDir, { recursive: true })
        }

        // Generate unique filename
        const ext = file.name.split(".").pop()?.toLowerCase() || "jpg"
        const hash = crypto.randomBytes(8).toString("hex")
        const timestamp = Date.now()
        const filename = `${timestamp}-${hash}.${ext}`
        const filepath = path.join(uploadDir, filename)

        // Convert file to buffer and write
        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)
        await writeFile(filepath, buffer)

        // Generate public URL
        const publicUrl = `/uploads/${type || "images"}/${filename}`

        return NextResponse.json({
            success: true,
            url: publicUrl,
            filename,
            size: file.size,
            type: file.type,
            dimensions: type === "banner" ? BANNER_DIMENSIONS : undefined,
        })

    } catch (error) {
        console.error("Upload error:", error)
        return NextResponse.json(
            { success: false, error: "Error al subir archivo" },
            { status: 500 }
        )
    }
}

/**
 * GET /api/upload - Get upload info and recommendations
 */
export async function GET() {
    return NextResponse.json({
        success: true,
        allowedTypes: ALLOWED_TYPES,
        maxFileSize: MAX_FILE_SIZE,
        maxFileSizeMB: MAX_FILE_SIZE / 1024 / 1024,
        bannerRecommendations: {
            ...BANNER_DIMENSIONS,
            description: "Tamaño recomendado para banners de eventos",
            tips: [
                "Usa imágenes de alta calidad (mínimo 1200x630px)",
                "Formato recomendado: JPG o WebP para mejor compresión",
                "Evita texto pequeño que no se lea en móviles",
                "Deja espacio para el título del evento superpuesto",
            ],
        },
    })
}
