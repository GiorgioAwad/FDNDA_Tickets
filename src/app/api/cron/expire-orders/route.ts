import { NextRequest, NextResponse } from "next/server"
import { expirePendingOrders } from "@/lib/order-expiration"

export const runtime = "nodejs"
export const maxDuration = 60

function isCronAuthorized(request: NextRequest): boolean {
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret) return true

    const authHeader = request.headers.get("authorization")
    if (authHeader === `Bearer ${cronSecret}`) return true

    const vercelCron = request.headers.get("x-vercel-cron")
    if (vercelCron === "1" || vercelCron === "true") return true

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
