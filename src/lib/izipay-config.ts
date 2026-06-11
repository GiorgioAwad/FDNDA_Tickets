import {
    IZIPAY_EMBEDDED_CONTAINER_ID,
    buildIzipayOrderNumber,
    formatIzipayDateTime,
    type IzipayWebCoreCheckoutConfig,
} from "@/lib/izipay"

// Restricciones oficiales Web Core (developers.izipay.pe/web-core/modalidades/parameters):
// street 5-40, city/state 3-25, firstName/lastName 2-50, email <=50, phone 7-15,
// postalCode 5-10, documentType DNI|CE|PASAPORTE|RUC|OTROS con longitud por tipo.
// Si un campo viola la regla, la pasarela rechaza el config y el checkout nunca abre.
const IZIPAY_FALLBACK_STREET = "Lima Peru"
const IZIPAY_FALLBACK_EMAIL =
    process.env.IZIPAY_FALLBACK_EMAIL || "pagos@ticketingfdnda.pe"
const IZIPAY_EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/

export function normalizeIzipayText(value: string, maxLength: number) {
    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9\s.,\-/]/g, " ")
        .replace(/\s+/g, " ")
        .trim()

    return normalized.slice(0, maxLength).trim()
}

// Izipay rejects dots and other punctuation in firstName/lastName.
export function normalizeIzipayName(value: string, maxLength: number) {
    const normalized = value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()

    return normalized.slice(0, maxLength).trim()
}

export function normalizeIzipayPhone(value: string | null | undefined) {
    const digits = (value || "").replace(/\D/g, "").slice(0, 15)
    return digits.length >= 7 ? digits : "999999999"
}

export function normalizeIzipayPostalCode(value: string | null | undefined) {
    const normalized = (value || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10)
    return normalized.length >= 5 ? normalized : "15001"
}

export function normalizeIzipayStreet(value: string | null | undefined) {
    const normalized = normalizeIzipayText(value || "", 40)
    return normalized.length >= 5 ? normalized : IZIPAY_FALLBACK_STREET
}

export function normalizeIzipayEmail(...candidates: Array<string | null | undefined>) {
    for (const candidate of candidates) {
        const email = (candidate || "").trim()
        if (email.length >= 5 && email.length <= 50 && IZIPAY_EMAIL_REGEX.test(email)) {
            return email
        }
    }
    return IZIPAY_FALLBACK_EMAIL
}

// documentType y document deben ser coherentes entre si: DNI = 8 digitos,
// RUC = 11 digitos, CE 9-12, PASAPORTE 8-12 (alfanumerico), OTROS 8-12.
export function resolveIzipayDocument(
    docTypeCode: string | null,
    rawValue: string | null | undefined
): { documentType: string; document: string } {
    const document = (rawValue || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)
    const digitsOnly = /^\d+$/.test(document)

    if (docTypeCode === "6" && digitsOnly && document.length === 11) {
        return { documentType: "RUC", document }
    }

    if (digitsOnly && document.length === 8) {
        return { documentType: "DNI", document }
    }

    if (digitsOnly && document.length >= 9 && document.length <= 12) {
        return { documentType: "CE", document }
    }

    if (document.length >= 8 && document.length <= 12) {
        return { documentType: "PASAPORTE", document }
    }

    if (document.length > 0 && document.length < 8 && digitsOnly) {
        return { documentType: "OTROS", document: document.padStart(8, "0") }
    }

    return { documentType: "OTROS", document: "00000000" }
}

// Izipay exige firstName y lastName de 2 a 50 caracteres.
export function splitName(
    fullName: string,
    isCompany: boolean
): { firstName: string; lastName: string } {
    const cleaned = normalizeIzipayName(fullName, 80)
    if (cleaned.length < 2) {
        return { firstName: "Cliente", lastName: "FDNDA" }
    }

    if (isCompany) {
        return {
            firstName: cleaned.slice(0, 50),
            lastName: "EMPRESA",
        }
    }

    const [firstName, ...rest] = cleaned.split(" ")
    const lastName = (rest.join(" ") || firstName).slice(0, 50)
    return {
        firstName: firstName.length >= 2 ? firstName.slice(0, 50) : "Cliente",
        lastName: lastName.length >= 2 ? lastName : "FDNDA",
    }
}

export function buildBuyerName(order: {
    buyerFirstName: string | null
    buyerSecondName: string | null
    buyerLastNamePaternal: string | null
    buyerLastNameMaternal: string | null
    buyerName: string | null
    user: {
        name: string
    }
}) {
    const personParts = [
        order.buyerFirstName,
        order.buyerSecondName,
        order.buyerLastNamePaternal,
        order.buyerLastNameMaternal,
    ]
        .filter(Boolean)
        .join(" ")
        .trim()

    return personParts || order.buyerName?.trim() || order.user.name
}

export interface IzipayCheckoutOrderInput {
    id: string
    userId: string
    currency: string
    totalAmount: unknown
    buyerDocType: string | null
    buyerDocNumber: string | null
    buyerAddress: string | null
    buyerEmail: string | null
    buyerPhone: string | null
    buyerUbigeo: string | null
    buyerFirstName: string | null
    buyerSecondName: string | null
    buyerLastNamePaternal: string | null
    buyerLastNameMaternal: string | null
    buyerName: string | null
    user: {
        name: string
        email: string
        phone: string | null
    }
}

export function buildCheckoutConfig(input: {
    order: IzipayCheckoutOrderInput
    merchantCode: string
    transactionId: string
    appUrl: string
    mode: "popup" | "redirect" | "embedded"
}): IzipayWebCoreCheckoutConfig {
    const fullName = buildBuyerName(input.order)
    const isCompany = input.order.buyerDocType === "6"
    const { firstName, lastName } = splitName(fullName, isCompany)
    const email = normalizeIzipayEmail(input.order.buyerEmail, input.order.user.email)
    const phoneNumber = normalizeIzipayPhone(input.order.buyerPhone || input.order.user.phone)
    const street = normalizeIzipayStreet(input.order.buyerAddress)
    const postalCode = normalizeIzipayPostalCode(input.order.buyerUbigeo)
    const { documentType, document } = resolveIzipayDocument(
        input.order.buyerDocType,
        input.order.buyerDocNumber
    )
    const amount = Number(input.order.totalAmount).toFixed(2)
    const orderNumber = buildIzipayOrderNumber(input.order.id)
    const city = "Lima"
    const state = "Lima"

    const billing = {
        firstName,
        lastName,
        email,
        phoneNumber,
        street,
        city,
        state,
        country: "PE",
        postalCode,
        documentType,
        document,
    }
    const redirectResultUrl = `${input.appUrl}/api/payments/izipay/redirect-result?orderId=${encodeURIComponent(input.order.id)}`

    return {
        action: "pay",
        merchantCode: input.merchantCode,
        transactionId: input.transactionId,
        order: {
            orderNumber,
            currency: input.order.currency,
            amount,
            processType: "AT",
            merchantBuyerId: input.order.userId,
            dateTimeTransaction: formatIzipayDateTime(),
        },
        billing,
        shipping: billing,
        render: {
            typeForm:
                input.mode === "embedded"
                    ? "embedded"
                    : input.mode === "redirect"
                        ? "redirect"
                        : "pop-up",
            container:
                input.mode === "embedded" ? `#${IZIPAY_EMBEDDED_CONTAINER_ID}` : undefined,
            showButtonProcessForm: input.mode === "embedded" ? true : undefined,
            redirectUrls: {
                onSuccess: redirectResultUrl,
                onError: redirectResultUrl,
                onCancel: redirectResultUrl,
            },
        },
        urlIPN: `${input.appUrl}/api/payments/izipay/webhook`,
    }
}

// Chequeo defensivo contra la tabla oficial de Web Core. No bloquea (la
// normalizacion ya deberia garantizar cumplimiento); solo loguea para poder
// diagnosticar rechazos de la pasarela por datos de un comprador especifico.
export function findIzipayConfigViolations(config: IzipayWebCoreCheckoutConfig): string[] {
    const violations: string[] = []
    const check = (field: string, value: string, min: number, max: number) => {
        if (value.length < min || value.length > max) {
            violations.push(
                `${field}="${value}" (longitud ${value.length}, esperado ${min}-${max})`
            )
        }
    }

    check("transactionId", config.transactionId, 5, 40)
    check("merchantCode", config.merchantCode, 7, 15)
    check("order.orderNumber", config.order.orderNumber, 5, 15)
    check("order.amount", config.order.amount, 4, 13)
    if (!/^\d+\.\d{2}$/.test(config.order.amount)) {
        violations.push(`order.amount="${config.order.amount}" (formato esperado NN.NN)`)
    }
    check("order.merchantBuyerId", config.order.merchantBuyerId, 6, 100)
    if (config.order.dateTimeTransaction.length !== 16) {
        violations.push(
            `order.dateTimeTransaction longitud ${config.order.dateTimeTransaction.length}, esperado 16`
        )
    }

    const billing = config.billing
    check("billing.firstName", billing.firstName, 2, 50)
    check("billing.lastName", billing.lastName, 2, 50)
    check("billing.email", billing.email, 5, 50)
    check("billing.phoneNumber", billing.phoneNumber, 7, 15)
    check("billing.street", billing.street, 5, 40)
    check("billing.city", billing.city, 3, 25)
    check("billing.state", billing.state, 3, 25)
    check("billing.postalCode", billing.postalCode, 5, 10)
    if (billing.country.length !== 2) {
        violations.push(`billing.country="${billing.country}" (ISO de 2 caracteres)`)
    }

    const documentRules: Record<string, [number, number]> = {
        DNI: [8, 8],
        RUC: [11, 11],
        CE: [9, 12],
        PASAPORTE: [8, 12],
        OTROS: [8, 12],
    }
    const documentRule = documentRules[billing.documentType]
    if (!documentRule) {
        violations.push(`billing.documentType="${billing.documentType}" no permitido`)
    } else {
        check("billing.document", billing.document, documentRule[0], documentRule[1])
    }

    return violations
}
