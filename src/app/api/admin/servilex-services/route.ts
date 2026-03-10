import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = request.nextUrl
        const indicator = searchParams.get("indicator")
        const search = searchParams.get("search")

        const where: Record<string, unknown> = { isActive: true }
        if (indicator) {
            where.indicador = indicator.toUpperCase()
        }
        if (search && search.trim().length >= 2) {
            where.descripcion = { contains: search.trim(), mode: "insensitive" }
        }

        const services = await prisma.servilexService.findMany({
            where,
            orderBy: [{ disciplina: "asc" }, { sede: "asc" }, { clases: "asc" }],
            select: {
                id: true,
                codigo: true,
                indicador: true,
                disciplina: true,
                sede: true,
                clases: true,
                descripcion: true,
            },
        })

        return NextResponse.json({ data: services })
    } catch (error) {
        console.error("Error fetching servilex services:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
