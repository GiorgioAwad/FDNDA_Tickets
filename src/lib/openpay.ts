import { NextRequest } from "next/server"

// ─── OpenPay Peru Configuration ──────────────────────────────────────────────

const OPENPAY_MERCHANT_ID = process.env.OPENPAY_MERCHANT_ID || ""
const OPENPAY_SECRET_KEY = process.env.OPENPAY_SECRET_KEY || ""
const OPENPAY_SANDBOX = process.env.OPENPAY_SANDBOX !== "false"
const OPENPAY_WEBHOOK_AUTH_USER = process.env.OPENPAY_WEBHOOK_AUTH_USER || ""
const OPENPAY_WEBHOOK_AUTH_PASS = process.env.OPENPAY_WEBHOOK_AUTH_PASS || ""

function getBaseUrl(): string {
    return OPENPAY_SANDBOX
        ? `https://sandbox-api.openpay.pe/v1/${OPENPAY_MERCHANT_ID}`
        : `https://api.openpay.pe/v1/${OPENPAY_MERCHANT_ID}`
}

function getAuthHeader(): string {
    // OpenPay uses Basic Auth: SK as username, empty password
    return `Basic ${Buffer.from(`${OPENPAY_SECRET_KEY}:`).toString("base64")}`
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface OpenPayChargeRequest {
    orderId: string
    amount: number // In PEN decimal (e.g., 100.75) — NOT cents
    currency: string
    description: string
    customerName: string
    customerEmail: string
    redirectUrl: string
    dueDate: string // ISO format: "2024-01-15T14:30:00"
}

export interface OpenPayChargeResponse {
    success: boolean
    chargeId?: string
    paymentUrl?: string
    raw?: unknown
    error?: string
}

export interface OpenPayWebhookTransaction {
    id: string
    authorization: string | null
    operation_type: string
    transaction_type: string
    status: string // "completed", "failed", "charge_pending", etc.
    creation_date: string
    operation_date: string
    description: string
    error_message: string | null
    order_id: string
    amount: number
    currency: string
    method: string
    card?: Record<string, unknown>
    customer?: {
        name: string
        last_name: string | null
        email: string
        phone_number: string | null
    }
    fee?: {
        amount: number
        tax: number
        currency: string
    }
}

export interface OpenPayWebhookPayload {
    type: string // "charge.succeeded", "charge.failed", "charge.cancelled", etc.
    event_date: string
    transaction: OpenPayWebhookTransaction
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Create a charge via OpenPay redirect flow.
 * The response includes a payment_method.url to redirect the user to.
 */
export async function createOpenPayCharge(
    data: OpenPayChargeRequest
): Promise<OpenPayChargeResponse> {
    try {
        const response = await fetch(`${getBaseUrl()}/charges`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: getAuthHeader(),
            },
            body: JSON.stringify({
                method: "card",
                amount: data.amount,
                currency: data.currency,
                description: data.description,
                order_id: data.orderId,
                confirm: "false",
                send_email: "false",
                redirect_url: data.redirectUrl,
                due_date: data.dueDate,
                customer: {
                    name: data.customerName,
                    email: data.customerEmail,
                },
            }),
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            const message =
                (errorData as Record<string, unknown>).description ||
                (errorData as Record<string, unknown>).message ||
                `HTTP ${response.status}`
            console.error("OpenPay charge creation failed:", errorData)
            return { success: false, error: String(message) }
        }

        const result = await response.json()
        const paymentUrl = result?.payment_method?.url as string | undefined

        if (!paymentUrl) {
            return {
                success: false,
                error: "OpenPay no devolvio URL de pago",
            }
        }

        return {
            success: true,
            chargeId: result.id as string,
            paymentUrl,
            raw: result,
        }
    } catch (error) {
        console.error("OpenPay charge creation error:", error)
        return {
            success: false,
            error: (error as Error).message,
        }
    }
}

/**
 * Get charge status from OpenPay (fallback if webhook is delayed).
 */
export async function getOpenPayCharge(chargeId: string): Promise<{
    success: boolean
    status?: string
    transactionId?: string
    authorization?: string
    raw?: unknown
    error?: string
}> {
    try {
        const response = await fetch(`${getBaseUrl()}/charges/${chargeId}`, {
            method: "GET",
            headers: {
                Authorization: getAuthHeader(),
            },
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            return {
                success: false,
                error:
                    (errorData as Record<string, unknown>).description as string ||
                    `HTTP ${response.status}`,
            }
        }

        const data = await response.json()
        return {
            success: true,
            status: data.status as string,
            transactionId: data.id as string,
            authorization: data.authorization as string | undefined,
            raw: data,
        }
    } catch (error) {
        return {
            success: false,
            error: (error as Error).message,
        }
    }
}

/**
 * Verify incoming webhook using Basic Auth credentials.
 * OpenPay can be configured to send webhooks with Basic Auth.
 */
export function verifyOpenPayWebhook(request: NextRequest): boolean {
    if (!OPENPAY_WEBHOOK_AUTH_USER || !OPENPAY_WEBHOOK_AUTH_PASS) {
        console.error("OpenPay webhook credentials not configured — rejecting webhook")
        return false
    }

    const authHeader = request.headers.get("authorization") || ""
    if (!authHeader.startsWith("Basic ")) {
        return false
    }

    const encoded = authHeader.slice(6)
    let decoded: string
    try {
        decoded = Buffer.from(encoded, "base64").toString("utf-8")
    } catch {
        return false
    }

    const [user, pass] = decoded.split(":")
    return user === OPENPAY_WEBHOOK_AUTH_USER && pass === OPENPAY_WEBHOOK_AUTH_PASS
}

/**
 * Map OpenPay transaction status/event type to our internal order status.
 */
export function mapOpenPayStatus(
    eventType: string,
    transactionStatus: string
): "PAID" | "CANCELLED" | "PENDING" {
    if (eventType === "charge.succeeded" && transactionStatus === "completed") {
        return "PAID"
    }
    if (
        eventType === "charge.failed" ||
        eventType === "charge.cancelled" ||
        transactionStatus === "failed" ||
        transactionStatus === "cancelled"
    ) {
        return "CANCELLED"
    }
    return "PENDING"
}

/**
 * Format a due_date string for OpenPay (30 minutes from now in Peru timezone).
 */
export function getChargeDueDate(): string {
    const now = new Date()
    now.setMinutes(now.getMinutes() + 30)
    // Format: YYYY-MM-DDTHH:mm:ss (OpenPay expects this without timezone offset)
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    const hours = String(now.getHours()).padStart(2, "0")
    const minutes = String(now.getMinutes()).padStart(2, "0")
    const seconds = String(now.getSeconds()).padStart(2, "0")
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`
}
