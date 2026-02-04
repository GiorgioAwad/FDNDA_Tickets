import { NextRequest, NextResponse } from "next/server"
import { processEmailQueue } from "@/lib/email-worker"
import { getQueueStats } from "@/lib/email-queue"

export const runtime = "nodejs"
export const maxDuration = 60 // 60 segundos máximo

/**
 * POST /api/cron/process-emails
 * Procesa la cola de emails pendientes
 * 
 * Llamar desde:
 * - Vercel Cron Jobs (vercel.json)
 * - External cron service
 * - Manual trigger
 */
export async function POST(request: NextRequest) {
    // Verificar token de autorización para cron jobs
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        )
    }

    try {
        const { processed, failed } = await processEmailQueue(20) // Procesar hasta 20 emails

        return NextResponse.json({
            success: true,
            processed,
            failed,
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
 * Obtiene estadísticas de la cola
 */
export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization")
    const cronSecret = process.env.CRON_SECRET
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
            { error: "Unauthorized" },
            { status: 401 }
        )
    }

    try {
        const stats = await getQueueStats()

        return NextResponse.json({
            success: true,
            stats,
            timestamp: new Date().toISOString(),
        })
    } catch (error) {
        console.error("Error getting queue stats:", error)
        return NextResponse.json(
            { error: "Failed to get stats" },
            { status: 500 }
        )
    }
}
