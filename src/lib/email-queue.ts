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

// Cola en memoria para desarrollo
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
 * Agregar email a la cola
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
    
    const priority = options?.priority ?? 5 // 1-10, menor = mayor prioridad

    try {
        if (redis) {
            // Usar sorted set para prioridad
            const score = priority * 1000000000000 + Date.now()
            await redis.zadd(QUEUE_KEY, { score, member: JSON.stringify(job) })
        } else {
            // Fallback a memoria
            memoryQueue.push({ job, priority })
            memoryQueue.sort((a, b) => a.priority - b.priority)
        }
        
        console.log(`📧 Email encolado: ${type} para ${to} (ID: ${jobId})`)
        return jobId
    } catch (error) {
        console.error("Error enqueueing email:", error)
        throw error
    }
}

/**
 * Obtener siguiente email de la cola
 */
export async function dequeueEmail(): Promise<EmailJob | null> {
    try {
        if (redis) {
            // Obtener el elemento con menor score (mayor prioridad)
            const result = await redis.zpopmin(QUEUE_KEY, 1) as Array<{ member: string; score: number }> | null
            if (result && result.length > 0) {
                const jobData = result[0].member
                const job = JSON.parse(jobData) as EmailJob
                
                // Verificar si está programado para después
                if (job.scheduledFor && new Date(job.scheduledFor) > new Date()) {
                    // Re-encolar con el mismo score
                    await redis.zadd(QUEUE_KEY, { 
                        score: new Date(job.scheduledFor).getTime(), 
                        member: JSON.stringify(job) 
                    })
                    return null
                }
                
                // Marcar como procesando
                await redis.hset(PROCESSING_KEY, { [job.id]: JSON.stringify(job) })
                return job
            }
            return null
        }
        
        // Fallback a memoria
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
 * Marcar job como completado
 */
export async function completeJob(jobId: string): Promise<void> {
    try {
        if (redis) {
            await redis.hdel(PROCESSING_KEY, jobId)
        } else {
            processingJobs.delete(jobId)
        }
        console.log(`✅ Email completado: ${jobId}`)
    } catch (error) {
        console.error("Error completing job:", error)
    }
}

/**
 * Marcar job como fallido y re-encolar si hay intentos restantes
 */
export async function failJob(job: EmailJob, error: string): Promise<void> {
    try {
        job.attempts++
        
        if (job.attempts < job.maxAttempts) {
            // Re-encolar con delay
            const delaySeconds = RETRY_DELAYS[job.attempts - 1] || 900
            job.scheduledFor = new Date(Date.now() + delaySeconds * 1000).toISOString()
            
            if (redis) {
                await redis.hdel(PROCESSING_KEY, job.id)
                await redis.zadd(QUEUE_KEY, { 
                    score: Date.now() + delaySeconds * 1000, 
                    member: JSON.stringify(job) 
                })
            } else {
                processingJobs.delete(job.id)
                memoryQueue.push({ job, priority: 10 })
            }
            
            console.log(`🔄 Email reintentará en ${delaySeconds}s: ${job.id} (intento ${job.attempts}/${job.maxAttempts})`)
        } else {
            // Mover a fallidos
            if (redis) {
                await redis.hdel(PROCESSING_KEY, job.id)
                await redis.hset(FAILED_KEY, { 
                    [job.id]: JSON.stringify({ ...job, error, failedAt: new Date().toISOString() }) 
                })
            } else {
                processingJobs.delete(job.id)
            }
            
            console.error(`❌ Email falló permanentemente: ${job.id} - ${error}`)
        }
    } catch (err) {
        console.error("Error failing job:", err)
    }
}

/**
 * Obtener estadísticas de la cola
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
 * Encolar email de confirmación de compra
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
    }, { priority: 1 }) // Alta prioridad
}

/**
 * Encolar email de bienvenida
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
 * Encolar email de reset de contraseña
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
 * Encolar email de cortesía reclamada
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
