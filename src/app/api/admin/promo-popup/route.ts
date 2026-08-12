import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { validatePromoPopupInput, type PromoPopupInput } from "@/lib/promo-popup"

export const runtime = "nodejs"

const PROMO_ID = "default"

async function requireAdmin() {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") return null
    return user
}

// Normaliza lo que llega del formulario: los strings vacios se guardan como
// NULL para que el componente pueda preguntar simplemente "hay valor?".
function toNullable(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

export async function GET() {
    try {
        const user = await requireAdmin()
        if (!user) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const promo = await prisma.promoPopup.findUnique({ where: { id: PROMO_ID } })
        return NextResponse.json({ success: true, promo })
    } catch (error) {
        console.error("admin promo-popup GET error:", error)
        return NextResponse.json(
            { success: false, error: "Error al cargar el popup" },
            { status: 500 }
        )
    }
}

export async function PUT(request: NextRequest) {
    try {
        const user = await requireAdmin()
        if (!user) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = await request.json()

        const input: PromoPopupInput = {
            isActive: body.isActive === true,
            eyebrow: toNullable(body.eyebrow),
            kicker: toNullable(body.kicker),
            title: typeof body.title === "string" ? body.title.trim() : "",
            description: toNullable(body.description),
            imageUrl: toNullable(body.imageUrl),
            linkUrl: toNullable(body.linkUrl),
            linkLabel: toNullable(body.linkLabel),
            mediaCaption: toNullable(body.mediaCaption),
            sections: Array.isArray(body.sections)
                ? body.sections.filter((s: unknown): s is string => typeof s === "string")
                : [],
        }

        const errors = validatePromoPopupInput(input)
        if (Object.keys(errors).length > 0) {
            return NextResponse.json({ success: false, errors }, { status: 400 })
        }

        const data = { ...input, updatedById: user.id }

        const promo = await prisma.promoPopup.upsert({
            where: { id: PROMO_ID },
            update: data,
            create: { id: PROMO_ID, ...data },
        })

        return NextResponse.json({ success: true, promo })
    } catch (error) {
        console.error("admin promo-popup PUT error:", error)
        return NextResponse.json(
            { success: false, error: "Error al guardar el popup" },
            { status: 500 }
        )
    }
}
