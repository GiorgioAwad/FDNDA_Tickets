export function isPoolBagTicketType(input: {
    eventCategory?: string | null
    isPackage?: boolean | null
    packageDaysCount?: number | null
}): boolean {
    return (
        input.eventCategory === "PISCINA_LIBRE" &&
        input.isPackage === true &&
        typeof input.packageDaysCount === "number" &&
        input.packageDaysCount > 0
    )
}

export function isPoolSlotTicketType(input: {
    eventCategory?: string | null
    isPackage?: boolean | null
}): boolean {
    return input.eventCategory === "PISCINA_LIBRE" && input.isPackage !== true
}
