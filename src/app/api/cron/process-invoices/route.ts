import { NextRequest, NextResponse } from "next/server"
import { getInvoiceQueueStats, processInvoiceQueue } from "@/lib/invoice-worker"
import { redis } from "@/lib/redis"

export const runtime = "nodejs"
export const maxDuration = 60

// Lock para garantizar el requisito de ABIO: un solo envio batch corriendo
// a la vez. TTL ligeramente menor al intervalo de 2 min para auto-liberar
// si la funcion muere a mitad de batch.
const ABIO_BATCH_LOCK_KEY = "abio:batch:lock"
const ABIO_BATCH_LOCK_TTL_SECONDS = 110

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

async function acquireBatchLock(): Promise<string | null> {
    if (!redis) return "no-redis"
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const result = await redis.set(ABIO_BATCH_LOCK_KEY, token, {
        nx: true,
        ex: ABIO_BATCH_LOCK_TTL_SECONDS,
    })
    return result === "OK" ? token : null
}

async function releaseBatchLock(token: string): Promise<void> {
    if (!redis || token === "no-redis") return
    const current = await redis.get<string>(ABIO_BATCH_LOCK_KEY)
    if (current === token) await redis.del(ABIO_BATCH_LOCK_KEY)
}

async function runQueueAndGetStats() {
    const lockToken = await acquireBatchLock()
    if (!lockToken) {
        const stats = await getInvoiceQueueStats()
        return { processed: 0, failed: 0, skipped: 0, stats, lockSkipped: true }
    }

    try {
        const { processed, failed, skipped } = await processInvoiceQueue(10)
        const stats = await getInvoiceQueueStats()
        return { processed, failed, skipped, stats, lockSkipped: false }
    } finally {
        await releaseBatchLock(lockToken)
    }
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
