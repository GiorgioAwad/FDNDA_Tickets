import { acquireLock, releaseLock } from "@/lib/cache"
import { processEmailQueue } from "@/lib/email-worker"
import { processInvoiceQueue } from "@/lib/invoice-worker"
import { reconcilePendingIzipayOrders } from "@/lib/izipay-reconciliation"
import { expirePendingOrders } from "@/lib/order-expiration"

type WorkerTask = {
    name: string
    intervalMs: number
    run: () => Promise<unknown>
}

function toPositiveInt(rawValue: string | undefined, fallback: number): number {
    const parsed = Number(rawValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback
    }
    return Math.floor(parsed)
}

const EMAIL_INTERVAL_MS = toPositiveInt(process.env.WORKER_EMAIL_INTERVAL_MS, 60_000)
const INVOICE_INTERVAL_MS = toPositiveInt(process.env.WORKER_INVOICE_INTERVAL_MS, 120_000)
const IZIPAY_RECONCILE_INTERVAL_MS = toPositiveInt(
    process.env.WORKER_IZIPAY_RECONCILE_INTERVAL_MS,
    180_000
)
const EXPIRE_ORDERS_INTERVAL_MS = toPositiveInt(process.env.WORKER_EXPIRE_ORDERS_INTERVAL_MS, 300_000)
const EMAIL_BATCH_SIZE = toPositiveInt(process.env.WORKER_EMAIL_BATCH_SIZE, 20)
const INVOICE_BATCH_SIZE = toPositiveInt(process.env.WORKER_INVOICE_BATCH_SIZE, 10)
const IZIPAY_RECONCILE_BATCH_SIZE = toPositiveInt(
    process.env.WORKER_IZIPAY_RECONCILE_BATCH_SIZE,
    25
)

let shuttingDown = false

const tasks: WorkerTask[] = [
    {
        name: "emails",
        intervalMs: EMAIL_INTERVAL_MS,
        run: () => processEmailQueue(EMAIL_BATCH_SIZE),
    },
    {
        name: "invoices",
        intervalMs: INVOICE_INTERVAL_MS,
        run: () => processInvoiceQueue(INVOICE_BATCH_SIZE),
    },
    {
        name: "izipay-reconcile",
        intervalMs: IZIPAY_RECONCILE_INTERVAL_MS,
        run: () => reconcilePendingIzipayOrders({ batchSize: IZIPAY_RECONCILE_BATCH_SIZE }),
    },
    {
        name: "expire-orders",
        intervalMs: EXPIRE_ORDERS_INTERVAL_MS,
        run: () => expirePendingOrders(),
    },
]

async function runTask(task: WorkerTask) {
    const lockKey = `worker:lock:${task.name}`
    const lockTtlSeconds = Math.max(60, Math.ceil(task.intervalMs / 1000))
    const acquired = await acquireLock(lockKey, lockTtlSeconds)

    if (!acquired) {
        return
    }

    try {
        const startedAt = Date.now()
        const result = await task.run()
        const durationMs = Date.now() - startedAt
        console.log(`[worker] ${task.name} completed in ${durationMs}ms`, result)
    } catch (error) {
        console.error(`[worker] ${task.name} failed`, error)
    } finally {
        await releaseLock(lockKey)
    }
}

function startLoop(task: WorkerTask) {
    const tick = async () => {
        if (shuttingDown) return

        const startedAt = Date.now()
        await runTask(task)
        const elapsed = Date.now() - startedAt
        const nextDelay = Math.max(1_000, task.intervalMs - elapsed)

        if (!shuttingDown) {
            setTimeout(tick, nextDelay)
        }
    }

    void tick()
}

function handleShutdown(signal: NodeJS.Signals) {
    console.log(`[worker] received ${signal}, shutting down`)
    shuttingDown = true

    setTimeout(() => process.exit(0), 250).unref()
}

process.on("SIGINT", handleShutdown)
process.on("SIGTERM", handleShutdown)

console.log("[worker] starting background loops", {
    emailIntervalMs: EMAIL_INTERVAL_MS,
    invoiceIntervalMs: INVOICE_INTERVAL_MS,
    izipayReconcileIntervalMs: IZIPAY_RECONCILE_INTERVAL_MS,
    expireOrdersIntervalMs: EXPIRE_ORDERS_INTERVAL_MS,
})

for (const task of tasks) {
    startLoop(task)
}
