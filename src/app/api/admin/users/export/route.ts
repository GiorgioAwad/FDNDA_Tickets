import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import { formatDateInput, formatDateTimeForExport } from "@/lib/utils"
import * as XLSX from "xlsx"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function calcAge(birthDate: Date | null): string {
    if (!birthDate) return ""
    const today = new Date()
    let age = today.getFullYear() - birthDate.getFullYear()
    const m = today.getMonth() - birthDate.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--
    }
    return age >= 0 && age < 130 ? String(age) : ""
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const { searchParams } = new URL(request.url)
        // ?role=USER por defecto exporta solo participantes (no staff/admin).
        // ?role=all exporta absolutamente todos.
        const requested = searchParams.get("role") || "USER"
        const validRoles = ["USER", "ADMIN", "STAFF", "TREASURY"] as const
        const roleFilter = requested === "all" || validRoles.includes(requested as never)
            ? requested
            : "USER"

        const users = await prisma.user.findMany({
            where:
                roleFilter === "all"
                    ? {}
                    : { role: roleFilter as (typeof validRoles)[number] },
            select: {
                id: true,
                name: true,
                dni: true,
                email: true,
                phone: true,
                birthDate: true,
                distrito: true,
                role: true,
                emailVerifiedAt: true,
                createdAt: true,
                _count: { select: { orders: true, tickets: true } },
            },
            orderBy: { createdAt: "asc" },
        })

        // Compras pagadas y monto gastado por usuario (una sola consulta agregada).
        const paidAgg = await prisma.order.groupBy({
            by: ["userId"],
            where: { status: "PAID" },
            _count: { _all: true },
            _sum: { totalAmount: true },
        })
        const paidByUser = new Map(
            paidAgg.map((row) => [
                row.userId,
                {
                    count: row._count._all,
                    total: row._sum.totalAmount ? Number(row._sum.totalAmount) : 0,
                },
            ])
        )

        const headers = [
            "n",
            "nombre",
            "dni",
            "edad",
            "fecha_nacimiento",
            "correo",
            "telefono",
            "distrito",
            "rol",
            "correo_verificado",
            "fecha_registro",
            "fecha_registro_utc",
            "ordenes_totales",
            "compras_pagadas",
            "monto_gastado_pen",
            "entradas",
        ]

        const rows = users.map((u, i) => {
            const paid = paidByUser.get(u.id)
            return [
                i + 1,
                u.name || "",
                u.dni || "",
                calcAge(u.birthDate),
                u.birthDate ? formatDateInput(u.birthDate) : "",
                u.email || "",
                u.phone || "",
                u.distrito || "",
                u.role,
                u.emailVerifiedAt ? "SI" : "NO",
                formatDateTimeForExport(u.createdAt),
                u.createdAt.toISOString(),
                u._count.orders,
                paid?.count ?? 0,
                paid?.total ?? 0,
                u._count.tickets,
            ]
        })

        const workbook = XLSX.utils.book_new()
        const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
        XLSX.utils.book_append_sheet(workbook, sheet, "Participantes")
        const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })

        const stamp = new Date().toISOString().slice(0, 10)
        const filename = `participantes-${roleFilter}-${stamp}.xlsx`

        return new NextResponse(fileBuffer, {
            headers: {
                "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="${filename}"`,
            },
        })
    } catch (error) {
        console.error("Error exporting users:", error)
        return NextResponse.json(
            { success: false, error: "Error al exportar participantes" },
            { status: 500 }
        )
    }
}
