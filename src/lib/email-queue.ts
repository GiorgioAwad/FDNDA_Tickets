import { Redis } from "@upstash/redis"

// ==================== TYPES ====================

export interface EmailJob {
    id: string
    type: "purchase_confirmation" | "ticket_qr" | "password_reset" | "welcome" | "courtesy_claimed"
    to: string
    data: Record<string, unknown>
    attempts: number
    maxAttempts: number
    createdAt: string
    scheduledFor?: string
}

interface QueuedEmail {
    job: EmailJob
    priority: number
}

// ==================== REDIS CLIENT ====================

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null

// In-memory queue fallback for local development.
const memoryQueue: QueuedEmail[] = []
const processingJobs = new Set<string>()

// ==================== CONSTANTS ====================

const QUEUE_KEY = "email:queue"
const PROCESSING_KEY = "email:processing"
const FAILED_KEY = "email:failed"
const MAX_ATTEMPTS = 3
const RETRY_DELAYS = [60, 300, 900] // 1min, 5min, 15min

// ==================== QUEUE FUNCTIONS ====================

/**
 * Add email job to queue.
 */
export async function queueEmail(
    type: EmailJob["type"],
    to: string,
    data: Record<string, unknown>,
    options?: { priority?: number; delay?: number }
): Promise<string> {
    const jobId = `email_${Date.now()}_${Math.random().toString(36).substring(7)}`

    const job: EmailJob = {
        id: jobId,
        type,
        to,
        data,
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        createdAt: new Date().toISOString(),
        scheduledFor: options?.delay
            ? new Date(Date.now() + options.delay * 1000).toISOString()
            : undefined,
    }

    const priority = options?.priority ?? 5 // 1-10, lower = higher priority

    try {
        if (redis) {
            // Use sorted set for priority.
            const score = priority * 1000000000000 + Date.now()
            await redis.zadd(QUEUE_KEY, { score, member: JSON.stringify(job) })
        } else {
            memoryQueue.push({ job, priority })
            memoryQueue.sort((a, b) => a.priority - b.priority)
        }

        console.log(`Email queued: ${type} -> ${to} (ID: ${jobId})`)
        return jobId
    } catch (error) {
        console.error("Error enqueueing email:", error)
        throw error
    }
}

function isEmailJob(value: unknown): value is EmailJob {
    if (!value || typeof value !== "object") return false
    const job = value as Partial<EmailJob>
    return typeof job.id === "string" &&
        typeof job.type === "string" &&
        typeof job.to === "string" &&
        typeof job.attempts === "number" &&
        typeof job.maxAttempts === "number" &&
        typeof job.createdAt === "string" &&
        !!job.data &&
        typeof job.data === "object"
}

/**
 * Extract job payload from Upstash zpopmin response.
 * Upstash client can return:
 * - ["{...job...}", "score"]
 * - [{ member: "{...job...}", score: 123 }]
 * - [{...job...}, score]
 */
function extractJobFromZpop(result: unknown): EmailJob | null {
    if (!Array.isArray(result) || result.length === 0) return null

    const first = result[0]
    if (typeof first === "string") {
        try {
            const parsed = JSON.parse(first) as unknown
            return isEmailJob(parsed) ? parsed : null
        } catch {
            return null
        }
    }

    if (first && typeof first === "object" && "member" in first) {
        const member = (first as { member?: unknown }).member
        if (typeof member === "string") {
            try {
                const parsed = JSON.parse(member) as unknown
                return isEmailJob(parsed) ? parsed : null
            } catch {
                return null
            }
        }
    }

    if (isEmailJob(first)) {
        return first
    }

    return null
}

/**
 * Get next email job from queue.
 */
export async function dequeueEmail(): Promise<EmailJob | null> {
    try {
        if (redis) {
            const result = await redis.zpopmin(QUEUE_KEY, 1) as unknown
            const job = extractJobFromZpop(result)

            if (!job) {
                if (Array.isArray(result) && result.length > 0) {
                    console.error("Unexpected zpopmin payload format:", result)
                }
                return null
            }

            if (job.scheduledFor && new Date(job.scheduledFor) > new Date()) {
                await redis.zadd(QUEUE_KEY, {
                    score: new Date(job.scheduledFor).getTime(),
                    member: JSON.stringify(job),
                })
                return null
            }

            await redis.hset(PROCESSING_KEY, { [job.id]: JSON.stringify(job) })
            return job
        }

        if (memoryQueue.length === 0) return null

        const { job } = memoryQueue.shift()!
        if (job.scheduledFor && new Date(job.scheduledFor) > new Date()) {
            memoryQueue.push({ job, priority: 10 })
            return null
        }

        processingJobs.add(job.id)
        return job
    } catch (error) {
        console.error("Error dequeuing email:", error)
        return null
    }
}

/**
 * Mark job as completed.
 */
export async function completeJob(jobId: string): Promise<void> {
    try {
        if (redis) {
            await redis.hdel(PROCESSING_KEY, jobId)
        } else {
            processingJobs.delete(jobId)
        }
        console.log(`Email completed: ${jobId}`)
    } catch (error) {
        console.error("Error completing job:", error)
    }
}

/**
 * Mark job as failed and requeue if attempts remain.
 */
export async function failJob(job: EmailJob, error: string): Promise<void> {
    try {
        job.attempts++

        if (job.attempts < job.maxAttempts) {
            const delaySeconds = RETRY_DELAYS[job.attempts - 1] || 900
            job.scheduledFor = new Date(Date.now() + delaySeconds * 1000).toISOString()

            if (redis) {
                await redis.hdel(PROCESSING_KEY, job.id)
                await redis.zadd(QUEUE_KEY, {
                    score: Date.now() + delaySeconds * 1000,
                    member: JSON.stringify(job),
                })
            } else {
                processingJobs.delete(job.id)
                memoryQueue.push({ job, priority: 10 })
            }

            console.log(`Email retry in ${delaySeconds}s: ${job.id} (${job.attempts}/${job.maxAttempts})`)
        } else {
            if (redis) {
                await redis.hdel(PROCESSING_KEY, job.id)
                await redis.hset(FAILED_KEY, {
                    [job.id]: JSON.stringify({ ...job, error, failedAt: new Date().toISOString() }),
                })
            } else {
                processingJobs.delete(job.id)
            }

            console.error(`Email failed permanently: ${job.id} - ${error}`)
        }
    } catch (err) {
        console.error("Error failing job:", err)
    }
}

/**
 * Get queue stats.
 */
export async function getQueueStats(): Promise<{
    pending: number
    processing: number
    failed: number
}> {
    try {
        if (redis) {
            const [pending, processing, failed] = await Promise.all([
                redis.zcard(QUEUE_KEY),
                redis.hlen(PROCESSING_KEY),
                redis.hlen(FAILED_KEY),
            ])
            return { pending, processing, failed }
        }

        return {
            pending: memoryQueue.length,
            processing: processingJobs.size,
            failed: 0,
        }
    } catch (error) {
        console.error("Error getting queue stats:", error)
        return { pending: 0, processing: 0, failed: 0 }
    }
}

// ==================== CONVENIENCE FUNCTIONS ====================

/**
 * Queue purchase confirmation email.
 */
export async function queuePurchaseConfirmation(
    email: string,
    userName: string,
    orderId: string,
    eventTitle: string,
    ticketCount: number,
    totalAmount: string
): Promise<string> {
    return queueEmail("purchase_confirmation", email, {
        userName,
        orderId,
        eventTitle,
        ticketCount,
        totalAmount,
    }, { priority: 1 })
}

/**
 * Queue welcome email.
 */
export async function queueWelcomeEmail(
    email: string,
    userName: string,
    verifyUrl: string
): Promise<string> {
    return queueEmail("welcome", email, {
        userName,
        verifyUrl,
    }, { priority: 3 })
}

/**
 * Queue password reset email.
 */
export async function queuePasswordResetEmail(
    email: string,
    userName: string,
    resetUrl: string
): Promise<string> {
    return queueEmail("password_reset", email, {
        userName,
        resetUrl,
    }, { priority: 2 })
}

/**
 * Queue courtesy claimed email.
 */
export async function queueCourtesyClaimedEmail(
    email: string,
    userName: string,
    eventTitle: string,
    ticketTypeName: string
): Promise<string> {
    return queueEmail("courtesy_claimed", email, {
        userName,
        eventTitle,
        ticketTypeName,
    }, { priority: 2 })
}
