export type BillingDocumentType = "BOLETA" | "FACTURA"

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
        buyerAddress: normalizeSpaces(input.buyerAddress),
        buyerEmail: normalizeSpaces(input.buyerEmail) || normalizeSpaces(fallbackEmail),
        buyerPhone: normalizeSpaces(input.buyerPhone),
        buyerUbigeo: normalizeSpaces(input.buyerUbigeo),
        buyerFirstName,
        buyerSecondName,
        buyerLastNamePaternal,
        buyerLastNameMaternal,
    }
}
