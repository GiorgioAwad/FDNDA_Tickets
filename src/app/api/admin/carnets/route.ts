import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { issueCarnet, planCarnetIssuance } from "@/lib/carnet-issuance"
import type { CarnetIssuanceInput } from "@/lib/carnet-issuance-rules"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        let body: Partial<CarnetIssuanceInput>
        try {
            body = (await request.json()) as Partial<CarnetIssuanceInput>
        } catch (error) {
            console.error("Error leyendo el cuerpo de la solicitud de emision de carnet:", error)
            return NextResponse.json(
                { success: false, errors: ["La solicitud no tiene un formato valido."] },
                { status: 400 }
            )
        }
        if (!body.userId || !body.ticketTypeId || !body.sourceRef) {
            return NextResponse.json(
                { success: false, errors: ["Previsualiza la emision antes de confirmarla."] },
                { status: 400 }
            )
        }

        // Revalidacion: el cupo pudo cambiar entre el preview y el clic, y el
        // plan viaja por la red, asi que no se confia en el que mande el
        // cliente. La guarda de duplicados definitiva vive dentro de la
        // transaccion de issueCarnet; esto es defensa en profundidad.
        const result = await planCarnetIssuance({
            ...body,
            userId: body.userId,
            ticketTypeId: body.ticketTypeId,
            sourceRef: body.sourceRef,
            reason: body.reason ?? "",
        })
        if (!result.ok) {
            return NextResponse.json({ success: false, errors: result.errors }, { status: 422 })
        }

        // issueCarnet es la unica fuente de errores deliberados de este tramo
        // (ya en espanol: cupo agotado, duplicado detectado dentro de la
        // transaccion, tipo de entrada eliminado, etc.). Se aisla en su
        // propio try/catch para poder devolver ese mensaje tal cual sin
        // arriesgarnos a filtrar el texto crudo de una excepcion inesperada
        // (error de Prisma, bug, etc.) de cualquier otro punto de la ruta.
        let issued
        try {
            issued = await issueCarnet(result.plan, { id: user.id, email: user.email })
        } catch (error) {
            console.error("Error emitiendo carnet:", error)
            const message = error instanceof Error ? error.message : "Error al emitir el carnet"
            return NextResponse.json({ success: false, errors: [message] }, { status: 500 })
        }

        return NextResponse.json({
            success: true,
            data: { ...issued, warnings: result.plan.warnings },
        })
    } catch (error) {
        console.error("Error emitiendo carnet:", error)
        return NextResponse.json(
            { success: false, errors: ["Error al emitir el carnet"] },
            { status: 500 }
        )
    }
}

export async function GET() {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const orders = await prisma.order.findMany({
            where: {
                provider: "PRESENCIAL",
                providerResponse: {
                    path: ["source"],
                    equals: "admin-carnet-panel",
                } as Prisma.JsonNullableFilter,
            },
            orderBy: { createdAt: "desc" },
            take: 50,
            select: {
                id: true,
                createdAt: true,
                totalAmount: true,
                providerResponse: true,
                user: { select: { name: true, email: true } },
                tickets: {
                    select: {
                        ticketCode: true,
                        attendeeName: true,
                        event: { select: { title: true } },
                        ticketType: { select: { name: true } },
                    },
                },
            },
        })

        const items = orders.map((order) => {
            const meta = (order.providerResponse ?? {}) as Record<string, unknown>
            const ticket = order.tickets[0]
            // El audit blob de issueCarnet (src/lib/carnet-issuance.ts) escribe
            // dos gates independientes, no un unico "forcedCapacity": el cupo
            // global y el cupo por fecha se pueden forzar por separado. Se
            // exponen ambos tal cual para que la UI decida como mostrarlos.
            return {
                orderId: order.id,
                createdAt: order.createdAt.toISOString(),
                amount: Number(order.totalAmount),
                issuedByEmail: typeof meta.issuedByEmail === "string" ? meta.issuedByEmail : "-",
                reason: typeof meta.reason === "string" ? meta.reason : "",
                forcedGlobalCapacity: meta.forcedGlobalCapacity === true,
                forcedDateCapacity: meta.forcedDateCapacity === true,
                userName: order.user.name,
                userEmail: order.user.email,
                ticketCode: ticket?.ticketCode ?? "-",
                attendeeName: ticket?.attendeeName ?? "-",
                eventTitle: ticket?.event.title ?? "-",
                ticketTypeName: ticket?.ticketType.name ?? "-",
            }
        })

        return NextResponse.json({ success: true, data: { items } })
    } catch (error) {
        console.error("Error cargando historial de carnets:", error)
        return NextResponse.json({ success: false, error: "Error al cargar historial" }, { status: 500 })
    }
}
