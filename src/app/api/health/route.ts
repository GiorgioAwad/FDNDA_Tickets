import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getQueueStats } from "@/lib/email-queue"
import { getInvoiceQueueStats } from "@/lib/invoice-worker"
import { redis } from "@/lib/redis"

export const runtime = "nodejs"

interface HealthStatus {
    status: "healthy" | "degraded" | "unhealthy"
    timestamp: string
    services: {
        database: {
            status: "up" | "down"
            latency?: number
        }
        redis: {
            status: "up" | "down" | "disabled"
            latency?: number
        }
        emailQueue: {
            status: "ok" | "warning" | "error"
            pending?: number
            failed?: number
        }
        invoiceQueue: {
            status: "ok" | "warning" | "error"
            pending?: number
            processing?: number
            failed?: number
            issued?: number
        }
        memory: {
            used: number
            total: number
            percentage: number
        }
    }
    version: string
}

export async function GET() {
    const health: HealthStatus = {
        status: "healthy",
        timestamp: new Date().toISOString(),
        services: {
            database: { status: "down" },
            redis: { status: "disabled" },
            emailQueue: { status: "ok" },
            invoiceQueue: { status: "ok" },
            memory: { used: 0, total: 0, percentage: 0 },
        },
        version: process.env.npm_package_version || "1.0.0",
    }

    // Check database
    try {
        const dbStart = Date.now()
        await prisma.$queryRaw`SELECT 1`
        health.services.database = {
            status: "up",
            latency: Date.now() - dbStart,
        }
    } catch (error) {
        health.status = "unhealthy"
        health.services.database = { status: "down" }
        console.error("Health check - Database error:", error)
    }

    // Check Redis
    if (redis) {
        try {
            const redisStart = Date.now()
            await redis.ping()
            health.services.redis = {
                status: "up",
                latency: Date.now() - redisStart,
            }
        } catch (error) {
            health.services.redis = { status: "down" }
            if (health.status === "healthy") {
                health.status = "degraded"
            }
            console.error("Health check - Redis error:", error)
        }
    } else if (process.env.NODE_ENV === "production") {
        health.services.redis = { status: "down" }
        if (health.status === "healthy") {
            health.status = "degraded"
        }
    }

    // Check Email Queue
    try {
        const queueStats = await getQueueStats()
        health.services.emailQueue = {
            status: queueStats.failed > 10 ? "warning" : "ok",
            pending: queueStats.pending,
            failed: queueStats.failed,
        }
    } catch (error) {
        health.services.emailQueue = { status: "error" }
        console.error("Health check - Email queue error:", error)
    }

    // Check Invoice Queue
    try {
        const invoiceStats = await getInvoiceQueueStats()
        health.services.invoiceQueue = {
            status: invoiceStats.failed > 10 ? "warning" : "ok",
            pending: invoiceStats.pending,
            processing: invoiceStats.processing,
            failed: invoiceStats.failed,
            issued: invoiceStats.issued,
        }
    } catch (error) {
        health.services.invoiceQueue = { status: "error" }
        console.error("Health check - Invoice queue error:", error)
    }

    // Check memory (Node.js)
    const memUsage = process.memoryUsage()
    health.services.memory = {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
        percentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
    }

    // If memory usage is > 90%, mark as degraded
    if (health.services.memory.percentage > 90) {
        health.status = health.status === "unhealthy" ? "unhealthy" : "degraded"
    }

    const statusCode = health.status === "healthy" ? 200 : health.status === "degraded" ? 200 : 503

    return NextResponse.json(health, { status: statusCode })
}
