import { NextRequest, NextResponse } from "next/server"
import { processEmailQueue } from "@/lib/email-worker"
import { getQueueStats } from "@/lib/email-queue"

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

async function runQueueAndGetStats() {
    const { processed, failed } = await processEmailQueue(20)
    const stats = await getQueueStats()
    return { processed, failed, stats }
}

/**
 * POST /api/cron/process-emails
 * Manual/externo: procesa cola de emails.
 */
export async function POST(request: NextRequest) {
    if (!isCronAuthorized(request)) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        )
    }

    try {
        const result = await runQueueAndGetStats()

        return NextResponse.json({
            success: true,
            ...result,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error("Error processing email queue:", error)
        return NextResponse.json(
            { error: "Failed to process queue" },
            { status: 500 }
        )
    }
}

/**
 * GET /api/cron/process-emails
 * En Vercel Cron (GET) procesa cola.
 * Manualmente devuelve stats; puedes forzar ejecucion con ?run=1.
 */
export async function GET(request: NextRequest) {
    if (!isCronAuthorized(request)) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        )
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

        const stats = await getQueueStats()
        return NextResponse.json({
            success: true,
            mode: "stats",
            stats,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error("Error in process-emails GET:", error)
        return NextResponse.json(
            { error: "Failed to process queue" },
            { status: 500 }
        )
    }
}
