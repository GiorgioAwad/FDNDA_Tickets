import { NextRequest, NextResponse } from "next/server"
import { Prisma, UserRole } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const dynamic = "force-dynamic"

const PAGE_SIZE_DEFAULT = 25
const PAGE_SIZE_MAX = 100

const ROLE_VALUES = new Set<UserRole>([
    UserRole.USER,
    UserRole.ADMIN,
    UserRole.STAFF,
    UserRole.TREASURY,
])

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || user.role !== "ADMIN") {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const { searchParams } = new URL(request.url)
        const page = Math.max(1, Number(searchParams.get("page") || "1"))
        const pageSize = Math.min(
            PAGE_SIZE_MAX,
            Math.max(1, Number(searchParams.get("pageSize") || String(PAGE_SIZE_DEFAULT)))
        )
        const search = searchParams.get("search")?.trim() || ""
        const roleParam = (searchParams.get("role") || "all").toUpperCase()

        const searchFilter: Prisma.UserWhereInput = search
            ? {
                  OR: [
                      { name: { contains: search, mode: "insensitive" } },
                      { email: { contains: search, mode: "insensitive" } },
                  ],
              }
            : {}

        const where: Prisma.UserWhereInput = {
            ...searchFilter,
            ...(roleParam !== "ALL" && ROLE_VALUES.has(roleParam as UserRole)
                ? { role: roleParam as UserRole }
                : {}),
        }

        const [users, total, roleCounts, verified] = await Promise.all([
            prisma.user.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    emailVerifiedAt: true,
                    createdAt: true,
                    _count: {
                        select: {
                            tickets: true,
                            orders: true,
                        },
                    },
                },
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            prisma.user.count({ where }),
            // Stats globales por rol (independientes de paginación/filtro).
            prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
            prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
        ])

        const countForRole = (role: UserRole) =>
            roleCounts.find((item) => item.role === role)?._count._all ?? 0

        const totalUsers = roleCounts.reduce((acc, item) => acc + item._count._all, 0)

        return NextResponse.json({
            success: true,
            data: {
                users,
                totalUsers,
                admins: countForRole(UserRole.ADMIN),
                scanners: countForRole(UserRole.STAFF), // STAFF is the scanner role
                treasury: countForRole(UserRole.TREASURY),
                verified,
                pagination: {
                    page,
                    pageSize,
                    total,
                    totalPages: Math.max(1, Math.ceil(total / pageSize)),
                },
            },
        })
    } catch (error) {
        console.error("Error fetching users:", error)
        return NextResponse.json(
            { success: false, error: "Error al obtener usuarios" },
            { status: 500 }
        )
    }
}
