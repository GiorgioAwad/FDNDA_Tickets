import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import {
    ABIO_EVENT_SUCURSALES,
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

    const countByCode = new Map<string, number>()
    for (const group of groups) {
        countByCode.set(group.sucursalCodigo, group._count._all)
    }

    // Union: codigos del registro (siempre visibles, aunque sin servicios sincronizados todavia)
    // + codigos auto-descubiertos en BD que no estan en el registro (futuras sucursales).
    const codeSet = new Set<string>()
    for (const entry of ABIO_EVENT_SUCURSALES) {
        codeSet.add(entry.code)
    }
    for (const code of countByCode.keys()) {
        codeSet.add(code)
    }

    const data = Array.from(codeSet)
        .sort((a, b) => a.localeCompare(b))
        .map((code) => ({
            code,
            name: resolveAbioSucursalName(code),
            servicesCount: countByCode.get(code) ?? 0,
        }))

    return NextResponse.json({ data })
}
