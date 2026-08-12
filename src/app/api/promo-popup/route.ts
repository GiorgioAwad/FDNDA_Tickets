import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolvePromoImage } from "@/lib/promo-popup"

export const runtime = "nodejs"

// Cacheable en el borde: la respuesta no depende de cookies ni de sesion. Un
// cambio en el admin tarda hasta un minuto en propagarse.
const CACHE_HEADERS = {
    "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
}

export async function GET() {
    try {
        const promo = await prisma.promoPopup.findUnique({ where: { id: "default" } })

        if (!promo || !promo.isActive || promo.sections.length === 0) {
            return NextResponse.json({ promo: null }, { headers: CACHE_HEADERS })
        }

        return NextResponse.json(
            {
                promo: {
                    eyebrow: promo.eyebrow,
                    kicker: promo.kicker,
                    title: promo.title,
                    description: promo.description,
                    image: resolvePromoImage(promo.linkUrl, promo.imageUrl),
                    mediaCaption: promo.mediaCaption,
                    linkUrl: promo.linkUrl,
                    linkLabel: promo.linkLabel,
                    sections: promo.sections,
                    version: promo.updatedAt.toISOString(),
                },
            },
            { headers: CACHE_HEADERS }
        )
    } catch (error) {
        console.error("promo-popup GET error:", error)
        // Un fallo de BD no debe romper la pagina ni quedarse cacheado.
        return NextResponse.json({ promo: null }, { headers: { "Cache-Control": "no-store" } })
    }
}
