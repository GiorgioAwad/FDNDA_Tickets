import { NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { rateLimit } from "@/lib/rate-limit"
import { cancelPoolVisit } from "@/lib/pool-bag-service"

export const runtime = "nodejs"

// DELETE /api/pool-bag/reservations/[id] — cancela una reserva futura, libera el
// cupo del horario y devuelve el crédito de la bolsa.
export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const user = await getCurrentUser()
    if (!user) {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const { success: rateOk } = await rateLimit(`poolbag:${user.id}`, "api")
    if (!rateOk) {
        return NextResponse.json(
            { success: false, error: "Demasiados intentos. Espera un momento." },
            { status: 429 }
        )
    }

    const { id } = await params
    const result = await cancelPoolVisit({ userId: user.id, reservationId: id })

    if (!result.ok) {
        return NextResponse.json({ success: false, error: result.error }, { status: result.status })
    }

    return NextResponse.json({ success: true, data: { reservationId: result.reservationId } })
}
