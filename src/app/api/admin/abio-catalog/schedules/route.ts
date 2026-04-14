import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { getAbioCatalogConfig } from "@/lib/abio-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = request.nextUrl
        const disciplina = String(searchParams.get("disciplina") || "").trim()
        if (!disciplina) {
            return NextResponse.json({ data: [] })
        }

        const config = getAbioCatalogConfig()
        const schedules = await prisma.abioCatalogSchedule.findMany({
            where: {
                codigoEmp: config.codigoEmp,
                disciplinaCodigo: disciplina,
                isActive: true,
            },
            orderBy: [{ horarioCodigo: "asc" }],
        })

        return NextResponse.json({ data: schedules })
    } catch (error) {
        console.error("Error fetching ABIO schedules:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
