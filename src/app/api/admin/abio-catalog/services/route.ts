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
        const sucursal = String(
            searchParams.get("sucursal") || getAbioCatalogConfig().defaultSucursales[0] || "01"
        ).trim()
        const search = String(searchParams.get("search") || "").trim()

        const services = await prisma.abioCatalogService.findMany({
            where: {
                codigoEmp: getAbioCatalogConfig().codigoEmp,
                sucursalCodigo: sucursal,
                isActive: true,
                ...(search
                    ? {
                          OR: [
                              { servicioCodigo: { contains: search, mode: "insensitive" } },
                              { servicioDescripcion: { contains: search, mode: "insensitive" } },
                          ],
                      }
                    : {}),
            },
            orderBy: [{ servicioCodigo: "asc" }],
            take: 200,
        })

        return NextResponse.json({ data: services })
    } catch (error) {
        console.error("Error fetching ABIO services:", error)
        return NextResponse.json({ error: "Error interno" }, { status: 500 })
    }
}
