import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth"
import { getUsdToPenRate } from "@/lib/exchange-rate"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
    const user = await getCurrentUser()
    if (!user || (user.role !== "ADMIN" && user.role !== "TREASURY")) {
        return NextResponse.json(
            { success: false, error: "No autorizado" },
            { status: 401 }
        )
    }

    const info = await getUsdToPenRate()
    return NextResponse.json({
        success: true,
        data: {
            rate: info.rate,
            source: info.source,
            fetchedAt: new Date(info.fetchedAt).toISOString(),
        },
    })
}
