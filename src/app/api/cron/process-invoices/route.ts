import { NextRequest, NextResponse } from "next/server"
import { getInvoiceQueueStats, processInvoiceQueue } from "@/lib/invoice-worker"

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

async function runQueueAndGetStats() {
    const { processed, failed, skipped } = await processInvoiceQueue(10)
    const stats = await getInvoiceQueueStats()
    return { processed, failed, skipped, stats }
}

export async function POST(request: NextRequest) {
    if (!isCronAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const result = await runQueueAndGetStats()
        return NextResponse.json({
            success: true,
            ...result,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error("Error processing invoice queue:", error)
        return NextResponse.json(
            { error: "Failed to process invoice queue" },
            { status: 500 }
        )
    }
}

export async function GET(request: NextRequest) {
    if (!isCronAuthorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const isVercelCron = request.headers.get("x-vercel-cron") === "1" ||
            request.headers.get("x-vercel-cron") === "true" ||
            request.headers.get("user-agent")?.includes("vercel-cron/1.0")
        const forceRun = request.nextUrl.searchParams.get("run") === "1"

        if (isVercelCron || forceRun) {
            const result = await runQueueAndGetStats()
            return NextResponse.json({
                success: true,
                mode: "process",
                ...result,
                timestamp: new Date().toISOString(),
            })
        }

        const stats = await getInvoiceQueueStats()
        return NextResponse.json({
            success: true,
            mode: "stats",
            stats,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error("Error in process-invoices GET:", error)
        return NextResponse.json(
            { error: "Failed to process invoice queue" },
            { status: 500 }
        )
    }
}
