import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClientIP, rateLimit } from "@/lib/rate-limit"
import { parsePromoEventInput } from "@/lib/promo-popup"

export const runtime = "nodejs"

const PROMO_ID = "default"

export async function POST(request: NextRequest) {
    try {
        const ip = getClientIP(request)
        const { success: rateLimitOk } = await rateLimit(`promo:${ip}`, "api")
        if (!rateLimitOk) {
            return NextResponse.json({ success: false }, { status: 429 })
        }

        const input = parsePromoEventInput(await request.json())
        if (!input) {
            return NextResponse.json({ success: false }, { status: 400 })
        }

        // createMany + skipDuplicates hace idempotente cada tipo de evento por
        // sesion/version sin convertir un reintento normal en error de servidor.
        await prisma.promoPopupEvent.createMany({
            data: [
                {
                    promoId: PROMO_ID,
                    version: new Date(input.version),
                    sessionId: input.sessionId,
                    kind: input.kind,
                    source: input.source,
                    pathname: input.pathname,
                },
            ],
            skipDuplicates: true,
        })

        return new NextResponse(null, { status: 204 })
    } catch (error) {
        // La analitica nunca debe interferir con la experiencia del visitante.
        console.error("promo-popup event POST error:", error)
        return NextResponse.json({ success: false }, { status: 500 })
    }
}
