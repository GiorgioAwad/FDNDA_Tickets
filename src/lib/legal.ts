const DEFAULT_LEGAL_ENTITY_NAME = "Federacion Deportiva Nacional de Deportes Acuaticos del Peru"
const DEFAULT_COMMERCIAL_NAME = "Ticketing FDNDA"
const DEFAULT_ADDRESS = "Jr. Nazca Cdra. 6 s/n Lima 11, Peru"
const DEFAULT_PHONE = "+51 941 632 535"
const DEFAULT_EMAIL = "ticketing@fdnda.org"

export const LEGAL_ENTITY_NAME =
    process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || DEFAULT_LEGAL_ENTITY_NAME

export const LEGAL_COMMERCIAL_NAME =
    process.env.NEXT_PUBLIC_LEGAL_COMMERCIAL_NAME ||
    process.env.NEXT_PUBLIC_APP_NAME ||
    DEFAULT_COMMERCIAL_NAME

export const LEGAL_RUC = process.env.NEXT_PUBLIC_LEGAL_RUC || ""
export const LEGAL_ADDRESS = process.env.NEXT_PUBLIC_LEGAL_ADDRESS || DEFAULT_ADDRESS
export const LEGAL_PHONE = process.env.NEXT_PUBLIC_LEGAL_PHONE || DEFAULT_PHONE
export const LEGAL_EMAIL = process.env.NEXT_PUBLIC_LEGAL_EMAIL || DEFAULT_EMAIL
export const PRIVACY_EMAIL = process.env.NEXT_PUBLIC_PRIVACY_EMAIL || LEGAL_EMAIL
export const COMPLAINTS_EMAIL = process.env.NEXT_PUBLIC_COMPLAINTS_EMAIL || LEGAL_EMAIL
export const PERSONAL_DATA_BANK_NAME = process.env.NEXT_PUBLIC_DATA_BANK_NAME || ""
export const PERSONAL_DATA_BANK_CODE = process.env.NEXT_PUBLIC_DATA_BANK_CODE || ""

export function formatPublishedDate(date: string) {
    return new Intl.DateTimeFormat("es-PE", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "America/Lima",
    }).format(new Date(date))
}
