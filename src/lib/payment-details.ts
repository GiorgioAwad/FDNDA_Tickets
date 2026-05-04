type JsonRecord = Record<string, unknown>

export const IZIPAY_OPERATION_NUMBER_MAX_LENGTH = 20

export interface OrderPaymentDetails {
    provider: string | null
    methodCode: string | null
    methodLabel: string | null
    brand: string | null
    operationNumber: string | null
}

type PaymentSourceOrder = {
    providerRef?: string | null
    providerTransactionId?: string | null
    providerResponse?: unknown
}

type PaymentPayloadParts = {
    providerResponse: JsonRecord | null
    payloadHttp: JsonRecord | null
    response: JsonRecord | null
    transactionDetails: JsonRecord | null
    firstTransaction: JsonRecord | null
    firstResponseOrder: JsonRecord | null
}

function asRecord(value: unknown): JsonRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null
    }

    return value as JsonRecord
}

function parseJsonRecord(value: unknown): JsonRecord | null {
    if (typeof value !== "string" || !value.trim()) {
        return null
    }

    try {
        return asRecord(JSON.parse(value))
    } catch {
        return null
    }
}

function asString(value: unknown): string | null {
    if (typeof value !== "string") return null
    const normalized = value.trim()
    return normalized ? normalized : null
}

function normalizeOperationNumber(raw: unknown): string | null {
    const value = asString(raw)
    if (!value || value.length > IZIPAY_OPERATION_NUMBER_MAX_LENGTH) return null
    return value
}

function getPaymentPayloadParts(order: PaymentSourceOrder): PaymentPayloadParts {
    const providerEnvelope = asRecord(order.providerResponse)
    const providerResponse = asRecord(providerEnvelope?.data) || providerEnvelope
    const payloadHttp = parseJsonRecord(providerResponse?.payloadHttp)
    const response = asRecord(providerResponse?.response) || asRecord(payloadHttp?.response)
    const transactionDetails =
        asRecord(providerResponse?.transactionDetails) || asRecord(payloadHttp?.transactionDetails)
    const transactions = Array.isArray(providerResponse?.transactions)
        ? (providerResponse?.transactions as unknown[])
        : Array.isArray(payloadHttp?.transactions)
            ? (payloadHttp?.transactions as unknown[])
            : []
    const responseOrders = Array.isArray(response?.order)
        ? (response?.order as unknown[])
        : []

    return {
        providerResponse,
        payloadHttp,
        response,
        transactionDetails,
        firstTransaction: asRecord(transactions[0]),
        firstResponseOrder: asRecord(responseOrders[0]),
    }
}

function resolveOperationNumber(
    order: PaymentSourceOrder,
    parts: PaymentPayloadParts
): string | null {
    return (
        normalizeOperationNumber(parts.firstTransaction?.uuid) ||
        normalizeOperationNumber(parts.firstResponseOrder?.referenceNumber) ||
        normalizeOperationNumber(parts.transactionDetails?.transactionId) ||
        normalizeOperationNumber(order.providerRef) ||
        normalizeOperationNumber(order.providerTransactionId)
    )
}

function prettifyPaymentMethod(method: string): string {
    return method
        .toLowerCase()
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase())
}

function normalizeBrand(rawBrand: string | null): string | null {
    if (!rawBrand) return null

    const brand = rawBrand.trim().toLowerCase().replace(/[\s-]+/g, "_")

    switch (brand) {
        case "ae":
            return "American Express"
        case "dn":
            return "Diners"
        case "mc":
            return "Mastercard"
        case "visa":
            return "VISA"
        case "mastercard":
        case "master_card":
            return "Mastercard"
        case "amex":
        case "american_express":
            return "American Express"
        case "diners":
        case "diners_club":
            return "Diners"
        default:
            return rawBrand.trim()
    }
}

function resolvePaymentMethodLabel(methodCode: string | null, brand: string | null): string | null {
    if (!methodCode) {
        return brand ? `Tarjeta ${brand}` : null
    }

    const normalized = methodCode.trim().toUpperCase().replace(/[\s-]+/g, "_")

    switch (normalized) {
        case "CARD":
            return brand ? `Tarjeta ${brand}` : "Tarjeta"
        case "CREDIT_CARD":
        case "CREDIT":
            return brand ? `Tarjeta de credito ${brand}` : "Tarjeta de credito"
        case "DEBIT_CARD":
        case "DEBIT":
            return brand ? `Tarjeta de debito ${brand}` : "Tarjeta de debito"
        case "YAPE":
            return "Yape"
        case "PLIN":
            return "Plin"
        case "QR":
            return "QR"
        case "TRANSFER":
        case "BANK_TRANSFER":
            return "Transferencia"
        case "CASH":
            return "Efectivo"
        default:
            return prettifyPaymentMethod(normalized)
    }
}

export function extractOrderPaymentDetails(order: {
    provider?: string | null
    providerRef?: string | null
    providerTransactionId?: string | null
    providerResponse?: unknown
}): OrderPaymentDetails {
    const parts = getPaymentPayloadParts(order)
    const firstTransaction = parts.firstTransaction
    const transactionDetails = parts.transactionDetails
    const transactionPaymentDetails = asRecord(firstTransaction?.paymentMethodDetails)
    const transactionPaymentCard = asRecord(transactionPaymentDetails?.card)
    const responseCard = asRecord(parts.response?.card)

    const rawMethod =
        asString(firstTransaction?.paymentMethodType) ||
        asString(firstTransaction?.paymentMethod) ||
        asString(transactionDetails?.paymentMethod) ||
        asString(parts.response?.payMethod) ||
        asString(transactionPaymentDetails?.paymentMethodType) ||
        asString(transactionPaymentDetails?.paymentMethod) ||
        asString(parts.providerResponse?.payMethod) ||
        asString(parts.providerResponse?.paymentMethod)

    const rawBrand =
        asString(firstTransaction?.brand) ||
        asString(transactionDetails?.cardBrand) ||
        asString(responseCard?.brand) ||
        asString(transactionPaymentDetails?.brand) ||
        asString(transactionPaymentCard?.brand) ||
        asString(parts.providerResponse?.cardBrand) ||
        asString(parts.providerResponse?.brand)

    const brand = normalizeBrand(rawBrand)

    return {
        provider: order.provider || null,
        methodCode: rawMethod,
        methodLabel: resolvePaymentMethodLabel(rawMethod, brand),
        brand,
        operationNumber: resolveOperationNumber(order, parts),
    }
}

export function extractIzipayOperationNumber(order: PaymentSourceOrder): string | null {
    return resolveOperationNumber(order, getPaymentPayloadParts(order))
}
