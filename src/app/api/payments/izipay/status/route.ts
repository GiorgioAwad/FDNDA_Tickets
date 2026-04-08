import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser, hasRole } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getIzipayOrderStatusById } from "@/lib/izipay-reconciliation"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()

        if (!user) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 401 }
            )
        }

        const orderId = request.nextUrl.searchParams.get("orderId") || ""
        if (!orderId) {
            return NextResponse.json(
                { success: false, error: "Falta orderId" },
                { status: 400 }
            )
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                userId: true,
            },
        })

        if (!order) {
            return NextResponse.json(
                { success: false, error: "Orden no encontrada" },
                { status: 404 }
            )
        }

        if (order.userId !== user.id && !hasRole(user.role, "ADMIN")) {
            return NextResponse.json(
                { success: false, error: "No autorizado" },
                { status: 403 }
            )
        }

        const status = await getIzipayOrderStatusById({ orderId })

        if (!status.success && status.error === "Lock backend unavailable") {
            return NextResponse.json(
                { success: false, error: status.error },
                {
                    status: 503,
                    headers: { "Cache-Control": "no-store" },
                }
            )
        }

        if (!status.success && status.error === "Orden no encontrada") {
            return NextResponse.json(
                { success: false, error: status.error },
                {
                    status: 404,
                    headers: { "Cache-Control": "no-store" },
                }
            )
        }

        if (!status.success) {
            return NextResponse.json(
                { success: false, error: status.error || "No se pudo reconciliar la orden" },
                {
                    status: 500,
                    headers: { "Cache-Control": "no-store" },
                }
            )
        }

        return NextResponse.json(
            {
                success: true,
                data: {
                    orderId: status.orderId,
                    status: status.status,
                    source: status.source,
                    reviewRequired: status.reviewRequired,
                    eventTitle: status.eventTitle,
                    processing: status.processing || false,
                    message: status.message || null,
                },
            },
            { headers: { "Cache-Control": "no-store" } }
        )
    } catch (error) {
        console.error("Izipay status error:", error)
        return NextResponse.json(
            { success: false, error: "Error al consultar estado de pago" },
            { status: 500 }
        )
    }
}
