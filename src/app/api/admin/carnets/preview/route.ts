import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser, hasRole } from "@/lib/auth"
import { planCarnetIssuance } from "@/lib/carnet-issuance"
import { buildPanelSourceRef, type CarnetIssuanceInput } from "@/lib/carnet-issuance-rules"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

// Dry-run: valida sin escribir nada. Genera el sourceRef que la UI debe
// reenviar tal cual al emitir (POST /api/admin/carnets), de modo que un
// doble clic choque contra la guarda de duplicados en vez de crear dos
// carnets.
export async function POST(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user || !hasRole(user.role, "ADMIN")) {
            return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
        }

        const body = (await request.json()) as Partial<CarnetIssuanceInput>
        if (!body.userId || !body.ticketTypeId) {
            return NextResponse.json(
                { success: false, errors: ["Elige un usuario y un tipo de entrada."] },
                { status: 400 }
            )
        }

        const input: CarnetIssuanceInput = {
            ...body,
            userId: body.userId,
            ticketTypeId: body.ticketTypeId,
            reason: body.reason ?? "",
            sourceRef: body.sourceRef || buildPanelSourceRef(body.userId, body.ticketTypeId),
        }

        const result = await planCarnetIssuance(input)
        if (!result.ok) {
            return NextResponse.json({ success: false, errors: result.errors }, { status: 422 })
        }

        return NextResponse.json({ success: true, data: { plan: result.plan } })
    } catch (error) {
        console.error("Error en preview de carnet:", error)
        return NextResponse.json(
            { success: false, errors: ["Error al previsualizar la emision"] },
            { status: 500 }
        )
    }
}
