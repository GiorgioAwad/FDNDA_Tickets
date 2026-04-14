import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const [services, disciplines, schedules, bindings, lastRuns] = await Promise.all([
            prisma.abioCatalogService.count({ where: { isActive: true } }),
            prisma.abioCatalogDiscipline.count({ where: { isActive: true } }),
            prisma.abioCatalogSchedule.count({ where: { isActive: true } }),
            prisma.abioCatalogBinding.count({ where: { isActive: true } }),
            prisma.abioCatalogSyncRun.findMany({
                orderBy: { startedAt: "desc" },
                take: 10,
            }),
        ])

        return NextResponse.json({
            data: {
                counts: {
                    services,
                    disciplines,
                    schedules,
                    bindings,
                },
                lastRuns,
            },
        })
    } catch (error) {
        console.error("Error fetching ABIO catalog status:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
