export interface MerchPickupSnapshot {
    id: string
    name: string
    address: string
    district: string | null
    instructions: string | null
}

export const LEGACY_MERCH_PICKUP: MerchPickupSnapshot = {
    id: "legacy-campo-de-marte",
    name: "Campo de Marte",
    address: "Sede Campo de Marte",
    district: "Jesus Maria",
    instructions: "Presenta tu numero de orden y DNI al momento del recojo.",
}

function optionalString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null
}

export function readMerchPickupSnapshot(value: unknown): MerchPickupSnapshot | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null

    const data = value as Record<string, unknown>
    const id = optionalString(data.id)
    const name = optionalString(data.name)
    const address = optionalString(data.address)

    if (!id || !name || !address) return null

    return {
        id,
        name,
        address,
        district: optionalString(data.district),
        instructions: optionalString(data.instructions),
    }
}

export function getMerchPickupSnapshot(value: unknown): MerchPickupSnapshot {
    return readMerchPickupSnapshot(value) ?? LEGACY_MERCH_PICKUP
}

export function formatMerchPickupAddress(location: Pick<MerchPickupSnapshot, "address" | "district">): string {
    if (!location.district || location.address.toLocaleLowerCase("es-PE").includes(location.district.toLocaleLowerCase("es-PE"))) {
        return location.address
    }
    return `${location.address}, ${location.district}`
}
