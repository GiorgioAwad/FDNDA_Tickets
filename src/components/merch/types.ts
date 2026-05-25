export type MerchCategory = "POLERA" | "GORRA" | "PIN" | "OTROS"
export type MerchZone = "LIMA" | "SUR" | "NORTE" | "ORIENTE" | "GENERICA"

export interface MerchVariantView {
    id: string
    size: string | null
    sku: string
    available: number
}

export interface MerchProductView {
    id: string
    slug: string
    name: string
    description: string | null
    category: MerchCategory
    zone: MerchZone
    etapa: string | null
    price: number
    currency: string
    imageUrl: string | null
    imageUrls: string[]
    hasSizes: boolean
    availableSizes: string[]
    isSoldOut: boolean
    variants: MerchVariantView[]
}
