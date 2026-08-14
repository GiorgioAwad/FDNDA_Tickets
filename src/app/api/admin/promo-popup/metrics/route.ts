import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"

const PROMO_ID = "default"

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const promo = await prisma.promoPopup.findUnique({
            where: { id: PROMO_ID },
            select: { updatedAt: true },
        })

        if (!promo) {
            return NextResponse.json({ success: true, metrics: null })
        }

        const [groups, lastEvent] = await Promise.all([
            prisma.promoPopupEvent.groupBy({
                by: ["kind", "source", "pathname"],
                where: { promoId: PROMO_ID, version: promo.updatedAt },
                _count: { _all: true },
            }),
            prisma.promoPopupEvent.findFirst({
                where: { promoId: PROMO_ID, version: promo.updatedAt },
                orderBy: { createdAt: "desc" },
                select: { createdAt: true },
            }),
        ])

        let impressions = 0
        let clicks = 0
        let closes = 0
        const clickSources: Record<string, number> = {}
        const closeSources: Record<string, number> = {}
        const routeCounts: Record<string, number> = {}

        for (const group of groups) {
            const count = group._count._all
            if (group.kind === "IMPRESSION") {
                impressions += count
                routeCounts[group.pathname] = (routeCounts[group.pathname] ?? 0) + count
            } else if (group.kind === "CLICK") {
                clicks += count
                if (group.source) clickSources[group.source] = (clickSources[group.source] ?? 0) + count
            } else if (group.kind === "CLOSE") {
                closes += count
                if (group.source) closeSources[group.source] = (closeSources[group.source] ?? 0) + count
            }
        }

        const topRoutes = Object.entries(routeCounts)
            .map(([pathname, count]) => ({ pathname, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)

        return NextResponse.json({
            success: true,
            metrics: {
                version: promo.updatedAt.toISOString(),
                impressions,
                clicks,
                closes,
                clickThroughRate: impressions > 0 ? (clicks / impressions) * 100 : 0,
                closeRate: impressions > 0 ? (closes / impressions) * 100 : 0,
                clickSources,
                closeSources,
                topRoutes,
                lastEventAt: lastEvent?.createdAt.toISOString() ?? null,
            },
        })
    } catch (error) {
        console.error("admin promo-popup metrics GET error:", error)
        return NextResponse.json(
            { success: false, error: "Error al cargar las metricas" },
            { status: 500 }
        )
    }
}
