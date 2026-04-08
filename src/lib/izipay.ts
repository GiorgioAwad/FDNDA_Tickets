import crypto from "crypto"

// Web Core / Token Session
const IZIPAY_API_KEY = process.env.IZIPAY_API_KEY || ""
const IZIPAY_HASH_KEY = process.env.IZIPAY_HASH_KEY || ""
const IZIPAY_PUBLIC_KEY =
    process.env.IZIPAY_PUBLIC_KEY ||
    process.env.NEXT_PUBLIC_IZIPAY_PUBLIC_KEY ||
    ""
const IZIPAY_ENDPOINT = process.env.IZIPAY_ENDPOINT || "https://sandbox-api-pw.izipay.pe"
const IZIPAY_CHECKOUT_SCRIPT_URL =
    process.env.IZIPAY_CHECKOUT_SCRIPT_URL ||
    process.env.IZIPAY_SCRIPT_URL ||
    process.env.NEXT_PUBLIC_IZIPAY_SCRIPT_URL ||
    (IZIPAY_ENDPOINT.includes("sandbox")
        ? "https://sandbox-checkout.izipay.pe/payments/v1/js/index.js"
        : "https://checkout.izipay.pe/payments/v1/js/index.js")

// Legacy embedded integration
const IZIPAY_EMBEDDED_USERNAME = process.env.IZIPAY_EMBEDDED_USERNAME || ""
const IZIPAY_EMBEDDED_PASSWORD = process.env.IZIPAY_EMBEDDED_PASSWORD || ""
const IZIPAY_HMAC_SHA256_KEY = process.env.IZIPAY_HMAC_SHA256_KEY || ""
const IZIPAY_EMBEDDED_ENDPOINT =
    process.env.IZIPAY_EMBEDDED_ENDPOINT || "https://sandbox-api-pw.izipay.pe"

export const IZIPAY_EMBEDDED_CONTAINER_ID = "izipay-sdk-container"

export type IzipayMode = "redirect" | "embedded"

export function getIzipayMode(): IzipayMode {
    const mode = process.env.IZIPAY_MODE || process.env.NEXT_PUBLIC_IZIPAY_MODE || "redirect"
    return mode === "embedded" ? "embedded" : "redirect"
}

export interface IzipayOrderData {
    action: "pay" | "pay_token_external"
    merchantCode: string
    transactionId: string
    order: {
        orderNumber: string
        currency: string
        amount: string
        processType: "AT"
        merchantBuyerId: string
        dateTimeTransaction: string
    }
    billing: IzipayWebCoreCheckoutConfig["billing"]
    shipping: IzipayWebCoreCheckoutConfig["shipping"]
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

export interface IzipayWebCoreCheckoutConfig {
    action: "pay" | "pay_token_external"
    merchantCode: string
    transactionId: string
    order: {
        orderNumber: string
        currency: string
        amount: string
        processType: "AT"
        merchantBuyerId: string
        dateTimeTransaction: string
    }
    billing: {
        firstName: string
        lastName: string
        email: string
        phoneNumber: string
        street: string
        city: string
        state: string
        country: string
        postalCode: string
        documentType: string
        document: string
    }
    shipping: {
        firstName: string
        lastName: string
        email: string
        phoneNumber: string
        street: string
        city: string
        state: string
        country: string
        postalCode: string
        documentType: string
        document: string
    }
    render?: {
        typeForm: "pop-up" | "embedded" | "redirect"
        container?: string
        showButtonProcessForm?: boolean
        redirectUrls?: {
            onSuccess: string
            onError: string
            onCancel: string
        }
    }
    urlIPN?: string
}

export interface IzipayWebCorePaymentResponse {
    code?: string
    message?: string
    messageUser?: string
    messageUserEng?: string
    payloadHttp?: string
    signature?: string
    transactionId?: string
    response?: {
        payMethod?: string
        order?: Array<{
            orderNumber?: string
            amount?: string
            currency?: string
            stateMessage?: string
            referenceNumber?: string
            codeAuth?: string
        }>
        card?: {
            brand?: string
            pan?: string
        }
        billing?: {
            email?: string
            documentType?: string
            document?: string
        }
    }
}

export interface IzipayWebCoreParsedResult {
    orderId: string
    transactionId: string
    status: "PAID" | "PENDING" | "ERROR"
    message?: string
    amount: number
    currency: string
    paymentMethod?: string
    raw: IzipayWebCorePaymentResponse
}

export type IzipayCheckoutConfig = IzipayWebCoreCheckoutConfig

export interface ParsedIzipayPaymentResult {
    code: string
    message?: string
    messageUser?: string
    messageUserEng?: string
    payloadHttp: string
    signature?: string
    transactionId?: string
    orderId?: string
    amount?: number
    currency?: string
    payMethod?: string
    raw: IzipayWebCorePaymentResponse
    payload: IzipayWebCorePaymentResponse
}

function timingSafeEqualString(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a)
    const bBuffer = Buffer.from(b)

    if (aBuffer.length !== bBuffer.length) {
        return false
    }

    return crypto.timingSafeEqual(aBuffer, bBuffer)
}

function generateIzipayHexSignature(data: string): string {
    return crypto
        .createHmac("sha256", IZIPAY_HASH_KEY)
        .update(data)
        .digest("hex")
}

function generateIzipayBase64Signature(payload: string): string {
    return crypto
        .createHmac("sha256", Buffer.from(IZIPAY_HASH_KEY, "utf-8"))
        .update(Buffer.from(payload, "utf-8"))
        .digest("base64")
}

export function isIzipayCommunicationError(code?: string): boolean {
    return code === "021" || code === "COMMUNICATION_ERROR"
}

export function resolveIzipayPublicKey(): string {
    return IZIPAY_PUBLIC_KEY
}

export function getIzipayCheckoutScriptUrl(): string {
    return IZIPAY_CHECKOUT_SCRIPT_URL
}

export function getIzipayScriptUrl(
    mode: IzipayMode = getIzipayMode(),
    containerId = IZIPAY_EMBEDDED_CONTAINER_ID
): string {
    if (mode !== "embedded") {
        return IZIPAY_CHECKOUT_SCRIPT_URL
    }

    if (IZIPAY_CHECKOUT_SCRIPT_URL.includes("mode=embedded")) {
        return IZIPAY_CHECKOUT_SCRIPT_URL
    }

    const separator = IZIPAY_CHECKOUT_SCRIPT_URL.includes("?") ? "&" : "?"
    return `${IZIPAY_CHECKOUT_SCRIPT_URL}${separator}mode=embedded&container=${encodeURIComponent(containerId)}`
}

export function formatIzipayDateTime(date = new Date()): string {
    // Izipay soporte solicitó epoch en microsegundos para QR Web Core.
    return String(Math.floor(date.getTime()) * 1000)
}

export function buildIzipayOrderNumber(orderId: string): string {
    const normalized = orderId.replace(/[^a-zA-Z0-9]/g, "")
    const candidate = normalized.slice(-15)
    return candidate.length >= 5 ? candidate : normalized.padStart(5, "0").slice(-5)
}

export function getIzipaySearchTransactionUrl(): string {
    const override = process.env.IZIPAY_SEARCH_TRANSACTION_URL?.trim()

    if (override) {
        return override
    }

    return `${IZIPAY_ENDPOINT.replace(/\/$/, "")}/orderinfo/v1/Transaction/Search`
}

export function getIzipayQueryLanguage(): "ESP" | "ENG" {
    const language = (process.env.IZIPAY_QUERY_LANGUAGE || "ESP").trim().toUpperCase()
    return language === "ENG" ? "ENG" : "ESP"
}

export function verifyIzipayWebCoreSignature(
    paymentResponse: Pick<IzipayWebCorePaymentResponse, "code" | "payloadHttp" | "signature">
): boolean {
    if (isIzipayCommunicationError(paymentResponse.code)) {
        return true
    }

    if (!paymentResponse.payloadHttp || !paymentResponse.signature || !IZIPAY_HASH_KEY) {
        return false
    }

    const expectedSignature = generateIzipayBase64Signature(paymentResponse.payloadHttp)
    return timingSafeEqualString(paymentResponse.signature, expectedSignature)
}

export function verifyIzipaySdkSignature(
    payloadHttp: string,
    signature: string
): boolean {
    return verifyIzipayWebCoreSignature({
        code: "00",
        payloadHttp,
        signature,
    })
}

export function parseIzipayWebCoreResponse(
    paymentResponse: IzipayWebCorePaymentResponse
): IzipayWebCoreParsedResult | null {
    const firstOrder = paymentResponse.response?.order?.[0]
    const orderId = firstOrder?.orderNumber || ""
    const transactionId = paymentResponse.transactionId || firstOrder?.referenceNumber || ""
    const currency = firstOrder?.currency || "PEN"
    const amount = Number(firstOrder?.amount || 0)
    const isPaid = paymentResponse.code === "00"
    const isPending = isIzipayCommunicationError(paymentResponse.code)

    if (!orderId) {
        return null
    }

    return {
        orderId,
        transactionId,
        status: isPaid ? "PAID" : isPending ? "PENDING" : "ERROR",
        message:
            paymentResponse.messageUser ||
            paymentResponse.message ||
            firstOrder?.stateMessage,
        amount,
        currency,
        paymentMethod: paymentResponse.response?.payMethod,
        raw: paymentResponse,
    }
}

export function parseIzipaySdkPaymentResponse(
    value: IzipayWebCorePaymentResponse | Record<string, unknown> | string
): ParsedIzipayPaymentResult | null {
    try {
        const raw =
            typeof value === "string"
                ? (JSON.parse(value) as IzipayWebCorePaymentResponse)
                : (value as IzipayWebCorePaymentResponse)

        const payload =
            raw.payloadHttp && raw.payloadHttp.trim()
                ? (JSON.parse(raw.payloadHttp) as IzipayWebCorePaymentResponse)
                : raw

        const parsed = parseIzipayWebCoreResponse({
            ...payload,
            transactionId: raw.transactionId || payload.transactionId,
        })

        return {
            code: payload.code || raw.code || "",
            message: payload.message || raw.message,
            messageUser: payload.messageUser || raw.messageUser,
            messageUserEng: payload.messageUserEng || raw.messageUserEng,
            payloadHttp:
                raw.payloadHttp && raw.payloadHttp.trim()
                    ? raw.payloadHttp
                    : JSON.stringify(payload),
            signature: raw.signature,
            transactionId: raw.transactionId || payload.transactionId,
            orderId: parsed?.orderId,
            amount: parsed?.amount,
            currency: parsed?.currency,
            payMethod: payload.response?.payMethod,
            raw,
            payload,
        }
    } catch {
        return null
    }
}

export function isIzipayPaymentApproved(result: { code?: string }): boolean {
    return result.code === "00"
}

export function verifyIzipayWebhookSignature(
    payload: IzipayWebhookPayload,
    receivedHash: string
): boolean {
    const dataToSign = `${payload.orderDetails.orderId}|${payload.orderDetails.amount}|${payload.orderDetails.currency}|${payload.transactionDetails.transactionId}`
    const expectedHash = generateIzipayHexSignature(dataToSign)

    try {
        return timingSafeEqualString(receivedHash, expectedHash)
    } catch {
        return false
    }
}

export async function createIzipaySession(
    orderData: IzipayOrderData
): Promise<IzipaySessionResponse> {
    try {
        const response = await fetch(`${IZIPAY_ENDPOINT}/security/v1/Token/Generate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                transactionId: orderData.transactionId,
            },
            body: JSON.stringify({
                requestSource: "ECOMMERCE",
                publicKey: IZIPAY_API_KEY,
                action: orderData.action,
                merchantCode: orderData.merchantCode,
                transactionId: orderData.transactionId,
                orderNumber: orderData.order.orderNumber,
                currency: orderData.order.currency,
                amount: orderData.order.amount,
                processType: orderData.order.processType,
                merchantBuyerId: orderData.order.merchantBuyerId,
                dateTimeTransaction: orderData.order.dateTimeTransaction,
                billing: orderData.billing,
                shipping: orderData.shipping,
            }),
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => "")
            let errorMessage = `HTTP ${response.status}`

            try {
                const errorData = JSON.parse(errorText) as Record<string, unknown>
                errorMessage =
                    String(
                        errorData.message ||
                        errorData.error ||
                        errorData.code ||
                        errorText ||
                        errorMessage
                    )
            } catch {
                if (errorText) {
                    errorMessage = errorText
                }
            }

            return {
                success: false,
                error: errorMessage,
            }
        }

        const data = (await response.json()) as Record<string, unknown>
        const answer = (data.answer as Record<string, unknown> | undefined) || undefined
        const responseData = (data.response as Record<string, unknown> | undefined) || undefined
        const sessionToken =
            (data.sessionToken as string | undefined) ||
            (responseData?.token as string | undefined) ||
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

export interface IzipaySearchTransactionInput {
    merchantCode: string
    orderNumber: string
    transactionId: string
    language?: "ESP" | "ENG"
}

export interface IzipaySearchTransactionResult {
    success: boolean
    status?: "PAID" | "PENDING" | "CANCELLED"
    orderNumber?: string
    transactionId?: string
    message?: string
    retryable?: boolean
    raw?: IzipayWebCorePaymentResponse
    error?: string
}

function isRetryableQueryStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500
}

export async function searchIzipayTransaction(
    input: IzipaySearchTransactionInput
): Promise<IzipaySearchTransactionResult> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10_000)

    try {
        const response = await fetch(getIzipaySearchTransactionUrl(), {
            method: "POST",
            headers: {
                Accept: "application/json",
                Authorization: IZIPAY_API_KEY,
                "Content-Type": "application/json",
                transactionId: input.transactionId,
            },
            signal: controller.signal,
            body: JSON.stringify({
                merchantCode: input.merchantCode,
                numberOrden: input.orderNumber,
                language: input.language || getIzipayQueryLanguage(),
            }),
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => "")
            let message = `HTTP ${response.status}`

            try {
                const errorData = JSON.parse(errorText) as Record<string, unknown>
                message =
                    String(errorData.message || errorData.error || errorData.code || message)
            } catch {
                if (errorText) {
                    message = errorText
                }
            }

            return {
                success: false,
                error: message,
                retryable: isRetryableQueryStatus(response.status),
            }
        }

        const data = (await response.json()) as IzipayWebCorePaymentResponse

        if (data.payloadHttp && data.signature && !verifyIzipayWebCoreSignature(data)) {
            return {
                success: false,
                error: "Invalid Izipay query signature",
                retryable: false,
                raw: data,
            }
        }

        const parsed = parseIzipaySdkPaymentResponse(data)
        if (!parsed?.orderId) {
            return {
                success: false,
                error: "Invalid Izipay query response",
                retryable: false,
                raw: data,
            }
        }

        const status = isIzipayPaymentApproved(parsed)
            ? "PAID"
            : isIzipayCommunicationError(parsed.code)
                ? "PENDING"
                : "CANCELLED"

        return {
            success: true,
            status,
            orderNumber: parsed.orderId,
            transactionId: parsed.transactionId,
            message: parsed.messageUser || parsed.message,
            raw: data,
        }
    } catch (error) {
        return {
            success: false,
            error:
                error instanceof Error && error.name === "AbortError"
                    ? "Izipay query timeout"
                    : (error as Error).message,
            retryable:
                !(error instanceof Error) || error.name === "AbortError",
        }
    } finally {
        clearTimeout(timeoutId)
    }
}

export async function mockIzipayPayment(orderId: string): Promise<{
    success: boolean
    transactionId: string
}> {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    return {
        success: true,
        transactionId: `MOCK-${Date.now()}-${orderId.slice(-6)}`,
    }
}

export interface IzipayFormTokenData {
    orderId: string
    amount: number // In cents (e.g. 1000 = S/ 10.00)
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

export function verifyEmbeddedFormHash(
    krAnswer: string,
    receivedHash: string
): boolean {
    const expectedHash = crypto
        .createHmac("sha256", IZIPAY_HMAC_SHA256_KEY)
        .update(krAnswer)
        .digest("hex")

    try {
        return timingSafeEqualString(receivedHash, expectedHash)
    } catch {
        return false
    }
}

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
        return timingSafeEqualString(receivedHash, expectedHash)
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
            transactionId:
                (transaction?.uuid as string) ||
                (transaction?.transactionId as string) ||
                "",
            status,
            paymentMethod: (transaction?.paymentMethodType as string) || undefined,
            amount: Number(orderDetails?.orderTotalAmount) || 0,
            currency: (orderDetails?.orderCurrency as string) || "PEN",
        }
    } catch {
        return null
    }
}
