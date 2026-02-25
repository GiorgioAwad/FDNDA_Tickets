import crypto from "crypto"

// IZIPAY Configuration - Redirect mode (basic gateway)
const IZIPAY_MERCHANT_CODE = process.env.IZIPAY_MERCHANT_CODE || ""
const IZIPAY_API_KEY = process.env.IZIPAY_API_KEY || ""
const IZIPAY_HASH_KEY = process.env.IZIPAY_HASH_KEY || ""
const IZIPAY_ENDPOINT = process.env.IZIPAY_ENDPOINT || "https://sandbox-api.izipay.pe"

// IZIPAY Configuration - Embedded mode (full gateway with QR, Yape, etc.)
const IZIPAY_EMBEDDED_USERNAME = process.env.IZIPAY_EMBEDDED_USERNAME || ""
const IZIPAY_EMBEDDED_PASSWORD = process.env.IZIPAY_EMBEDDED_PASSWORD || ""
const IZIPAY_HMAC_SHA256_KEY = process.env.IZIPAY_HMAC_SHA256_KEY || ""
const IZIPAY_EMBEDDED_ENDPOINT = process.env.IZIPAY_EMBEDDED_ENDPOINT || "https://sandbox-api-pw.izipay.pe"
const IZIPAY_PUBLIC_KEY = process.env.NEXT_PUBLIC_IZIPAY_PUBLIC_KEY || ""

export type IzipayMode = "redirect" | "embedded"

export function getIzipayMode(): IzipayMode {
    const mode = process.env.IZIPAY_MODE || process.env.NEXT_PUBLIC_IZIPAY_MODE || "redirect"
    return mode === "embedded" ? "embedded" : "redirect"
}

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
    paymentUrl?: string
    raw?: unknown
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

        const data = await response.json() as Record<string, unknown>
        const answer = (data.answer as Record<string, unknown> | undefined) || undefined
        const sessionToken =
            (data.sessionToken as string | undefined) ||
            (answer?.sessionToken as string | undefined) ||
            (data.token as string | undefined)
        const formToken =
            (data.formToken as string | undefined) ||
            (answer?.formToken as string | undefined)
        const paymentUrl =
            (data.paymentUrl as string | undefined) ||
            (data.redirectUrl as string | undefined) ||
            (data.checkoutUrl as string | undefined) ||
            (data.url as string | undefined) ||
            (answer?.paymentUrl as string | undefined) ||
            (answer?.redirectUrl as string | undefined) ||
            (answer?.url as string | undefined)

        return {
            success: true,
            sessionToken,
            formToken,
            paymentUrl,
            raw: data,
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

// ─── Embedded mode (full gateway: cards + QR + Yape + Plin) ─────────────────

export interface IzipayFormTokenData {
    orderId: string
    amount: number // In cents (e.g., 1000 = S/ 10.00)
    currency: string
    customerEmail: string
    customerFirstName: string
    customerLastName: string
    customerPhone?: string
    customerIdentityType?: string
    customerIdentityCode?: string
}

export interface IzipayFormTokenResponse {
    success: boolean
    formToken?: string
    error?: string
}

/**
 * Create a formToken via Izipay's CreatePayment API (V4).
 * Used for embedded/pop-in checkout that supports all payment methods.
 */
export async function createIzipayFormToken(
    data: IzipayFormTokenData
): Promise<IzipayFormTokenResponse> {
    try {
        const credentials = Buffer.from(
            `${IZIPAY_EMBEDDED_USERNAME}:${IZIPAY_EMBEDDED_PASSWORD}`
        ).toString("base64")

        const response = await fetch(
            `${IZIPAY_EMBEDDED_ENDPOINT}/api-payment/V4/Charge/CreatePayment`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Basic ${credentials}`,
                },
                body: JSON.stringify({
                    amount: data.amount,
                    currency: data.currency,
                    orderId: data.orderId,
                    customer: {
                        email: data.customerEmail,
                        billingDetails: {
                            firstName: data.customerFirstName,
                            lastName: data.customerLastName,
                            phoneNumber: data.customerPhone || undefined,
                            identityType: data.customerIdentityType || undefined,
                            identityCode: data.customerIdentityCode || undefined,
                        },
                    },
                }),
            }
        )

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            const message =
                (errorData as Record<string, unknown>).errorMessage ||
                (errorData as Record<string, unknown>).message ||
                `HTTP ${response.status}`
            return { success: false, error: String(message) }
        }

        const result = (await response.json()) as Record<string, unknown>
        const answer = result.answer as Record<string, unknown> | undefined
        const formToken =
            (answer?.formToken as string | undefined) ||
            (result.formToken as string | undefined)

        if (!formToken) {
            return { success: false, error: "Izipay no devolvio formToken" }
        }

        return { success: true, formToken }
    } catch (error) {
        console.error("Izipay CreatePayment error:", error)
        return { success: false, error: (error as Error).message }
    }
}

/**
 * Verify the HMAC-SHA256 hash returned by the embedded form (kr-hash).
 */
export function verifyEmbeddedFormHash(
    krAnswer: string,
    receivedHash: string
): boolean {
    const expectedHash = crypto
        .createHmac("sha256", IZIPAY_HMAC_SHA256_KEY)
        .update(krAnswer)
        .digest("hex")

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
 * Verify IPN webhook hash from the embedded gateway.
 * Uses the PASSWORD key (different from the HMAC key used for form responses).
 */
export function verifyEmbeddedIpnHash(
    krAnswer: string,
    receivedHash: string
): boolean {
    const passwordKey = IZIPAY_EMBEDDED_PASSWORD
    const expectedHash = crypto
        .createHmac("sha256", passwordKey)
        .update(krAnswer)
        .digest("hex")

    try {
        return crypto.timingSafeEqual(
            Buffer.from(receivedHash),
            Buffer.from(expectedHash)
        )
    } catch {
        return false
    }
}

export interface EmbeddedPaymentResult {
    orderId: string
    transactionId: string
    status: "PAID" | "UNPAID" | "CANCELLED" | "ERROR"
    paymentMethod?: string
    amount: number
    currency: string
}

/**
 * Parse the kr-answer JSON from the embedded form into a structured result.
 */
export function parseEmbeddedAnswer(krAnswerJson: string): EmbeddedPaymentResult | null {
    try {
        const answer = JSON.parse(krAnswerJson) as Record<string, unknown>
        const orderDetails = answer.orderDetails as Record<string, unknown> | undefined
        const transactions = answer.transactions as Array<Record<string, unknown>> | undefined
        const transaction = transactions?.[0]

        const orderStatus = answer.orderStatus as string | undefined
        let status: EmbeddedPaymentResult["status"] = "ERROR"
        if (orderStatus === "PAID") status = "PAID"
        else if (orderStatus === "UNPAID") status = "UNPAID"
        else if (orderStatus === "CANCELLED" || orderStatus === "ABANDONED") status = "CANCELLED"

        return {
            orderId: (orderDetails?.orderId as string) || "",
            transactionId: (transaction?.uuid as string) || (transaction?.transactionId as string) || "",
            status,
            paymentMethod: (transaction?.paymentMethodType as string) || undefined,
            amount: Number(orderDetails?.orderTotalAmount) || 0,
            currency: (orderDetails?.orderCurrency as string) || "PEN",
        }
    } catch {
        return null
    }
}

export { IZIPAY_PUBLIC_KEY }
