import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import {
    DEFAULT_ABIO_EVENT_SUCURSAL_CODE,
    resolveAbioSucursalName,
} from "@/lib/abio-sucursales"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
    const user = await getCurrentUser()
    if (!user || user.role !== "ADMIN") {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const groups = await prisma.abioCatalogService.groupBy({
        by: ["sucursalCodigo"],
        where: { isActive: true },
        _count: { _all: true },
    })

    const byCode = new Map<string, number>()
    for (const group of groups) {
        byCode.set(group.sucursalCodigo, group._count._all)
    }

    if (!byCode.has(DEFAULT_ABIO_EVENT_SUCURSAL_CODE)) {
        byCode.set(DEFAULT_ABIO_EVENT_SUCURSAL_CODE, 0)
    }

    const data = Array.from(byCode.entries())
        .map(([code, servicesCount]) => ({
            code,
            name: resolveAbioSucursalName(code),
            servicesCount,
        }))
        .sort((a, b) => a.code.localeCompare(b.code))

    return NextResponse.json({ data })
}
