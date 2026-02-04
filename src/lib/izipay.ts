import crypto from "crypto"

// IZIPAY Configuration
const IZIPAY_MERCHANT_CODE = process.env.IZIPAY_MERCHANT_CODE || ""
const IZIPAY_API_KEY = process.env.IZIPAY_API_KEY || ""
const IZIPAY_HASH_KEY = process.env.IZIPAY_HASH_KEY || ""
const IZIPAY_ENDPOINT = process.env.IZIPAY_ENDPOINT || "https://sandbox-api.izipay.pe"

export interface IzipayOrderData {
    orderId: string
    amount: number // In cents (e.g., 1000 = S/ 10.00)
    currency: string
    customerEmail: string
    customerName: string
    description: string
}

export interface IzipaySessionResponse {
    success: boolean
    sessionToken?: string
    formToken?: string
    error?: string
}

export interface IzipayWebhookPayload {
    orderStatus: "PAID" | "UNPAID" | "CANCELLED" | "ERROR"
    orderDetails: {
        orderId: string
        amount: number
        currency: string
    }
    transactionDetails: {
        transactionId: string
        authorizationCode: string
        paymentMethod: string
        cardBrand?: string
        lastFourDigits?: string
    }
    hash: string
}

/**
 * Generate HMAC signature for IZIPAY requests
 */
function generateIzipaySignature(data: string): string {
    return crypto
        .createHmac("sha256", IZIPAY_HASH_KEY)
        .update(data)
        .digest("hex")
}

/**
 * Verify webhook signature from IZIPAY
 */
export function verifyIzipayWebhookSignature(
    payload: IzipayWebhookPayload,
    receivedHash: string
): boolean {
    const dataToSign = `${payload.orderDetails.orderId}|${payload.orderDetails.amount}|${payload.orderDetails.currency}|${payload.transactionDetails.transactionId}`
    const expectedHash = generateIzipaySignature(dataToSign)

    try {
        return crypto.timingSafeEqual(
            Buffer.from(receivedHash),
            Buffer.from(expectedHash)
        )
    } catch {
        return false
    }
}

/**
 * Create a payment session with IZIPAY
 */
export async function createIzipaySession(
    orderData: IzipayOrderData
): Promise<IzipaySessionResponse> {
    try {
        // Generate request signature
        const timestamp = Date.now().toString()
        const signatureData = `${IZIPAY_MERCHANT_CODE}|${orderData.orderId}|${orderData.amount}|${orderData.currency}|${timestamp}`
        const signature = generateIzipaySignature(signatureData)

        // Make API request to IZIPAY
        const response = await fetch(`${IZIPAY_ENDPOINT}/api/v1/payments/sessions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${IZIPAY_API_KEY}`,
                "X-Merchant-Code": IZIPAY_MERCHANT_CODE,
                "X-Signature": signature,
                "X-Timestamp": timestamp,
            },
            body: JSON.stringify({
                merchantCode: IZIPAY_MERCHANT_CODE,
                orderId: orderData.orderId,
                amount: orderData.amount,
                currency: orderData.currency,
                customer: {
                    email: orderData.customerEmail,
                    name: orderData.customerName,
                },
                description: orderData.description,
                returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success`,
                cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/cancel`,
                webhookUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/payments/izipay/webhook`,
            }),
        })

        if (!response.ok) {
            const errorData = await response.json()
            return {
                success: false,
                error: errorData.message || "Error creating payment session",
            }
        }

        const data = await response.json()

        return {
            success: true,
            sessionToken: data.sessionToken,
            formToken: data.formToken,
        }
    } catch (error) {
        console.error("IZIPAY session creation error:", error)
        return {
            success: false,
            error: (error as Error).message,
        }
    }
}

/**
 * Get payment status from IZIPAY
 */
export async function getIzipayPaymentStatus(orderId: string): Promise<{
    success: boolean
    status?: "PAID" | "PENDING" | "CANCELLED" | "ERROR"
    transactionId?: string
    error?: string
}> {
    try {
        const timestamp = Date.now().toString()
        const signatureData = `${IZIPAY_MERCHANT_CODE}|${orderId}|${timestamp}`
        const signature = generateIzipaySignature(signatureData)

        const response = await fetch(
            `${IZIPAY_ENDPOINT}/api/v1/payments/orders/${orderId}`,
            {
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${IZIPAY_API_KEY}`,
                    "X-Merchant-Code": IZIPAY_MERCHANT_CODE,
                    "X-Signature": signature,
                    "X-Timestamp": timestamp,
                },
            }
        )

        if (!response.ok) {
            const errorData = await response.json()
            return {
                success: false,
                error: errorData.message || "Error getting payment status",
            }
        }

        const data = await response.json()

        return {
            success: true,
            status: data.status,
            transactionId: data.transactionId,
        }
    } catch (error) {
        return {
            success: false,
            error: (error as Error).message,
        }
    }
}

/**
 * Mock payment for development/testing
 * Simulates a successful IZIPAY payment
 */
export async function mockIzipayPayment(orderId: string): Promise<{
    success: boolean
    transactionId: string
}> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return {
        success: true,
        transactionId: `MOCK-${Date.now()}-${orderId.slice(-6)}`,
    }
}
