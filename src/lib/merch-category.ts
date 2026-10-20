export const DEFAULT_MERCH_CATEGORIES = ["POLO", "POLERA", "GORRA", "PIN", "LLAVERO", "TOALLA", "OTROS"]

export function normalizeMerchCategory(value: unknown): string | null {
    if (typeof value !== "string") return null
    const category = value.normalize("NFC").trim().replace(/[\s_-]+/g, "_").toUpperCase()
    if (!category || category.length > 40 || category === "ALL") return null
    return /^[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*$/u.test(category) ? category : null
}

const LABELS: Record<string, [string, string]> = {
    POLO: ["Polo", "Polos"],
    POLERA: ["Polera", "Poleras"],
    GORRA: ["Gorra", "Gorras"],
    PIN: ["Pin", "Pines"],
    LLAVERO: ["Llavero", "Llaveros"],
    TOALLA: ["Toalla", "Toallas"],
    OTROS: ["Otros", "Otros"],
}

export function merchCategoryLabel(category: string, plural = false): string {
    if (Object.hasOwn(LABELS, category)) return LABELS[category][plural ? 1 : 0]
    return category.toLocaleLowerCase("es").replace(/_/g, " ").replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("es"))
}

export function merchCategoryHasBackImage(category: string): boolean {
    return category === "POLO" || category === "POLERA"
}
