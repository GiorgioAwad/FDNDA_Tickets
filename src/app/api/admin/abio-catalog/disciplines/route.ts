import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { getAbioCatalogConfig } from "@/lib/abio-catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(_request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const config = getAbioCatalogConfig()
        const disciplines = await prisma.abioCatalogDiscipline.findMany({
            where: {
                codigoEmp: config.codigoEmp,
                isActive: true,
            },
            orderBy: [{ disciplinaCodigo: "asc" }],
        })

        return NextResponse.json({ data: disciplines })
    } catch (error) {
        console.error("Error fetching ABIO disciplines:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
