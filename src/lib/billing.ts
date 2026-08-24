import { formatUbigeoLocation } from "@/lib/ubigeo-peru"

export type BillingDocumentType = "BOLETA" | "FACTURA"

/**
 * Etiqueta legible del comprobante que solicitó el comprador.
 * Las órdenes legacy (previas a la captura de datos de facturación) no tienen
 * `documentType`, por lo que se devuelve el `fallback` ("—" en UI, "" en Excel).
 */
export function formatComprobanteLabel(
    documentType: string | null | undefined,
    fallback = "—"
): string {
    if (documentType === "FACTURA") return "Factura"
    if (documentType === "BOLETA") return "Boleta"
    return fallback
}

/** Quita acentos y baja a minúsculas para comparar nombres de lugares de forma laxa. */
function deburr(s: string): string {
    return s
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim()
}

/**
 * Une la calle con "Distrito, Provincia, Departamento" derivados del ubigeo.
 * Si la calle ya menciona el distrito, no lo duplica.
 */
function composeBuyerAddress(street: string, ubigeo: string): string {
    const location = formatUbigeoLocation(ubigeo)
    if (!location) return street
    if (!street) return location
    const distrito = location.split(",")[0]?.trim() ?? ""
    if (distrito && deburr(street).includes(deburr(distrito))) return street
    return `${street}, ${location}`
}

export interface BillingSnapshotInput {
    documentType: BillingDocumentType
    buyerDocNumber: string
    buyerName?: string | null
    buyerAddress?: string | null
    buyerEmail?: string | null
    buyerPhone?: string | null
    buyerUbigeo?: string | null
    buyerFirstName?: string | null
    buyerSecondName?: string | null
    buyerLastNamePaternal?: string | null
    buyerLastNameMaternal?: string | null
}

export interface BillingSnapshot {
    documentType: BillingDocumentType
    buyerDocType: string
    buyerDocNumber: string
    buyerName: string
    buyerAddress: string
    buyerEmail: string
    buyerPhone: string
    buyerUbigeo: string
    buyerFirstName: string
    buyerSecondName: string
    buyerLastNamePaternal: string
    buyerLastNameMaternal: string
}

const normalizeSpaces = (value: string | null | undefined): string =>
    (value || "").replace(/\s+/g, " ").trim()

export interface BillingValidationIssue {
    field: Exclude<keyof BillingSnapshotInput, "documentType">
    message: string
}

export function getBillingValidationIssues(
    input: BillingSnapshotInput
): BillingValidationIssue[] {
    const issues: BillingValidationIssue[] = []
    const value = (field: Exclude<keyof BillingSnapshotInput, "documentType">) =>
        normalizeSpaces(input[field])

    if (input.documentType === "BOLETA") {
        if (!/^\d{8}$/.test(value("buyerDocNumber"))) {
            issues.push({ field: "buyerDocNumber", message: "Ingresa un DNI válido de 8 dígitos." })
        }
    } else {
        if (!/^\d{11}$/.test(value("buyerDocNumber"))) {
            issues.push({ field: "buyerDocNumber", message: "Ingresa un RUC válido de 11 dígitos." })
        }
        if (value("buyerName").length < 2) {
            issues.push({ field: "buyerName", message: "Ingresa la razón social." })
        }
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value("buyerEmail"))) {
        issues.push({
            field: "buyerEmail",
            message: "Ingresa un correo válido, por ejemplo nombre@correo.com.",
        })
    }
    if (!/^\d{7,15}$/.test(value("buyerPhone"))) {
        issues.push({ field: "buyerPhone", message: "Ingresa un celular válido de 7 a 15 dígitos." })
    }
    if (!/^\d{5,6}$/.test(value("buyerUbigeo"))) {
        issues.push({ field: "buyerUbigeo", message: "Selecciona departamento, provincia y distrito." })
    }
    if (value("buyerAddress").length < 5) {
        issues.push({ field: "buyerAddress", message: "Ingresa una dirección de al menos 5 caracteres." })
    }

    if (input.documentType === "BOLETA") {
        if (value("buyerFirstName").length < 2) {
            issues.push({ field: "buyerFirstName", message: "Ingresa el primer nombre." })
        }
        if (value("buyerLastNamePaternal").length < 2) {
            issues.push({ field: "buyerLastNamePaternal", message: "Ingresa el apellido paterno." })
        }
        if (value("buyerLastNameMaternal").length < 2) {
            issues.push({ field: "buyerLastNameMaternal", message: "Ingresa el apellido materno." })
        }
    }

    return issues
}

export function buildNaturalPersonFullName(input: {
    firstName?: string | null
    secondName?: string | null
    lastNamePaternal?: string | null
    lastNameMaternal?: string | null
}): string {
    return [
        normalizeSpaces(input.firstName),
        normalizeSpaces(input.secondName),
        normalizeSpaces(input.lastNamePaternal),
        normalizeSpaces(input.lastNameMaternal),
    ]
        .filter(Boolean)
        .join(" ")
}

export function splitNaturalPersonName(fullName: string): {
    firstName: string
    secondName: string
    lastNamePaternal: string
    lastNameMaternal: string
} {
    const parts = normalizeSpaces(fullName).split(" ").filter(Boolean)

    if (parts.length >= 4) {
        return {
            firstName: parts[0],
            secondName: parts.slice(1, parts.length - 2).join(" "),
            lastNamePaternal: parts[parts.length - 2],
            lastNameMaternal: parts[parts.length - 1],
        }
    }

    if (parts.length === 3) {
        return {
            firstName: parts[0],
            secondName: "",
            lastNamePaternal: parts[1],
            lastNameMaternal: parts[2],
        }
    }

    if (parts.length === 2) {
        return {
            firstName: parts[0],
            secondName: "",
            lastNamePaternal: parts[1],
            lastNameMaternal: "",
        }
    }

    return {
        firstName: parts[0] || "",
        secondName: "",
        lastNamePaternal: "",
        lastNameMaternal: "",
    }
}

export function buildBillingSnapshot(
    input: BillingSnapshotInput,
    fallbackEmail?: string | null
): BillingSnapshot {
    const normalizedName = normalizeSpaces(input.buyerName)
    const fallbackNames = splitNaturalPersonName(normalizedName)
    const buyerFirstName = normalizeSpaces(input.buyerFirstName) || fallbackNames.firstName
    const buyerSecondName = normalizeSpaces(input.buyerSecondName) || fallbackNames.secondName
    const buyerLastNamePaternal =
        normalizeSpaces(input.buyerLastNamePaternal) || fallbackNames.lastNamePaternal
    const buyerLastNameMaternal =
        normalizeSpaces(input.buyerLastNameMaternal) || fallbackNames.lastNameMaternal

    return {
        documentType: input.documentType,
        buyerDocType: input.documentType === "FACTURA" ? "6" : "1",
        buyerDocNumber: normalizeSpaces(input.buyerDocNumber),
        buyerName:
            input.documentType === "BOLETA"
                ? buildNaturalPersonFullName({
                    firstName: buyerFirstName,
                    secondName: buyerSecondName,
                    lastNamePaternal: buyerLastNamePaternal,
                    lastNameMaternal: buyerLastNameMaternal,
                })
                : normalizedName,
        buyerAddress: composeBuyerAddress(
            normalizeSpaces(input.buyerAddress),
            normalizeSpaces(input.buyerUbigeo)
        ),
        buyerEmail: normalizeSpaces(input.buyerEmail) || normalizeSpaces(fallbackEmail),
        buyerPhone: normalizeSpaces(input.buyerPhone),
        buyerUbigeo: normalizeSpaces(input.buyerUbigeo),
        buyerFirstName,
        buyerSecondName,
        buyerLastNamePaternal,
        buyerLastNameMaternal,
    }
}
