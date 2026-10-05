// Códigos SUNAT de cabecera.entidad (API ABIO, sección 4.5.3).
// Los límites de C.E. y PAS también cumplen el formulario de pago de Izipay.
export const IDENTITY_DOCUMENTS = {
    "1": { label: "DNI", minLength: 8, maxLength: 8, pattern: /^\d{8}$/, placeholder: "12345678", message: "El DNI debe tener exactamente 8 dígitos." },
    "6": { label: "RUC", minLength: 11, maxLength: 11, pattern: /^\d{11}$/, placeholder: "20123456789", message: "El RUC debe tener exactamente 11 dígitos." },
    "4": { label: "Carnet de extranjería (C.E.)", minLength: 9, maxLength: 12, pattern: /^\d{9,12}$/, placeholder: "001234567", message: "El C.E. debe tener entre 9 y 12 dígitos." },
    "7": { label: "Pasaporte (PAS)", minLength: 8, maxLength: 12, pattern: /^[A-Za-z0-9]{8,12}$/, placeholder: "AB123456", message: "El pasaporte debe tener entre 8 y 12 letras o números, sin espacios ni guiones." },
} as const

export type IdentityDocumentType = keyof typeof IDENTITY_DOCUMENTS
export const IDENTITY_DOCUMENT_TYPES: IdentityDocumentType[] = ["1", "6", "4", "7"]

export function isIdentityDocumentType(value: unknown): value is IdentityDocumentType {
    return typeof value === "string" && Object.hasOwn(IDENTITY_DOCUMENTS, value)
}

export function resolveBuyerDocType(documentType: string, buyerDocType?: string | null): IdentityDocumentType {
    if (documentType === "FACTURA") return "6"
    return isIdentityDocumentType(buyerDocType) ? buyerDocType : "1"
}

export function getIdentityDocumentError(type: unknown, number: string): string | null {
    if (!isIdentityDocumentType(type)) return "Selecciona un tipo de documento válido."
    return IDENTITY_DOCUMENTS[type].pattern.test(number.trim()) ? null : IDENTITY_DOCUMENTS[type].message
}

export function sanitizeIdentityDocumentNumber(type: IdentityDocumentType, value: string): string {
    return value.replace(type === "7" ? /[^a-zA-Z0-9]/g : /\D/g, "").toUpperCase().slice(0, IDENTITY_DOCUMENTS[type].maxLength)
}

export function getBillingIdentityError(input: { documentType: string; buyerDocType?: string | null; buyerDocNumber: string }): string | null {
    const type = input.buyerDocType ?? (input.documentType === "FACTURA" ? "6" : "1")
    if (input.documentType === "FACTURA" && type !== "6") return "La factura solo admite RUC. C.E. y pasaporte están disponibles para boleta."
    return getIdentityDocumentError(type, input.buyerDocNumber)
}
