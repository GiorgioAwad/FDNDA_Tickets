import { NextRequest, NextResponse } from "next/server"
import { expirePendingOrders } from "@/lib/order-expiration"

export const runtime = "nodejs"
export const maxDuration = 60

function isCronAuthorized(request: NextRequest): boolean {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) {
        console.error("CRON_SECRET is not configured — rejecting cron request")
        return false
    }

    const authHeader = request.headers.get("authorization")
    if (authHeader === `Bearer ${cronSecret}`) return true

    return false
}

export async function POST(request: NextRequest) {
    if (!isCronAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const result = await expirePendingOrders()
        return NextResponse.json(result)
    } catch (error) {
        console.error("Error expiring pending orders:", error)
        return NextResponse.json(
            { success: false, error: "Failed to expire pending orders" },
            { status: 500 }
        )
    }
}
