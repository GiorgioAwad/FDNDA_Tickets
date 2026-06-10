import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"

export const runtime = "nodejs"

// Devuelve el perfil de comprobante guardado por el usuario (o null) para
// autorrellenar el checkout.
export async function GET() {
    const user = await getCurrentUser()
    if (!user) {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    const profile = await prisma.userBillingProfile.findUnique({
        where: { userId: user.id },
        select: {
            documentType: true,
            buyerDocNumber: true,
            buyerName: true,
            buyerAddress: true,
            buyerEmail: true,
            buyerPhone: true,
            buyerUbigeo: true,
            buyerFirstName: true,
            buyerSecondName: true,
            buyerLastNamePaternal: true,
            buyerLastNameMaternal: true,
            updatedAt: true,
        },
    })

    return NextResponse.json({ success: true, data: profile })
}

// Permite al usuario olvidar sus datos guardados (control de su PII).
export async function DELETE() {
    const user = await getCurrentUser()
    if (!user) {
        return NextResponse.json({ success: false, error: "No autorizado" }, { status: 401 })
    }

    await prisma.userBillingProfile.deleteMany({ where: { userId: user.id } })
    return NextResponse.json({ success: true })
}
