export const PROMO_SECTIONS = ["INICIO", "EVENTOS", "MERCH", "MI_CUENTA", "TODO_PUBLICO"] as const

export type PromoSection = (typeof PROMO_SECTIONS)[number]

export interface PromoImage {
    url: string | null
    fit: "cover" | "contain"
}

// Rutas donde el popup no debe salir nunca: paneles internos, el camino de
// compra y las pantallas de autenticacion. Manda sobre TODO_PUBLICO.
const BLOCKED_PREFIXES = [
    "/admin",
    "/scanner",
    "/tesoreria",
    "/checkout",
    "/canjear",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
]

// Secciones que se resuelven por prefijo de ruta. INICIO se compara exacto y
// TODO_PUBLICO no tiene prefijo, por eso quedan fuera de este mapa.
const SECTION_PREFIXES: Record<string, string> = {
    EVENTOS: "/eventos",
    MERCH: "/merch",
    MI_CUENTA: "/mi-cuenta",
}

function matchesPrefix(pathname: string, prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function isBlockedPromoPath(pathname: string): boolean {
    return BLOCKED_PREFIXES.some((prefix) => matchesPrefix(pathname, prefix))
}

// Un ID de YouTube son 11 caracteres de [A-Za-z0-9_-]. Validarlo evita armar
// una URL de miniatura con basura pegada.
function sanitizeYoutubeId(raw: string): string | null {
    const id = raw.trim()
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
}

export function extractYoutubeId(url: string | null | undefined): string | null {
    if (!url) return null

    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return null
    }

    const host = parsed.hostname.replace(/^www\./, "")

    if (host === "youtu.be") {
        return sanitizeYoutubeId(parsed.pathname.slice(1))
    }

    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com") {
        return null
    }

    if (parsed.pathname === "/watch") {
        return sanitizeYoutubeId(parsed.searchParams.get("v") ?? "")
    }

    const segments = parsed.pathname.split("/").filter(Boolean)
    if (segments.length === 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
        return sanitizeYoutubeId(segments[1])
    }

    return null
}

/**
 * Imagen final del popup. La subida gana y se muestra recortada porque el arte
 * se sube a medida; la miniatura de YouTube se muestra contenida para no
 * recortar arte que no controlamos.
 */
export function resolvePromoImage(
    linkUrl: string | null | undefined,
    imageUrl: string | null | undefined
): PromoImage {
    if (imageUrl) {
        return { url: imageUrl, fit: "cover" }
    }

    const youtubeId = extractYoutubeId(linkUrl)
    if (youtubeId) {
        return { url: `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`, fit: "contain" }
    }

    return { url: null, fit: "cover" }
}

export function isPromoVisibleOnPath(sections: string[], pathname: string): boolean {
    if (isBlockedPromoPath(pathname)) return false
    if (sections.includes("TODO_PUBLICO")) return true
    if (sections.includes("INICIO") && pathname === "/") return true

    return Object.entries(SECTION_PREFIXES).some(
        ([section, prefix]) => sections.includes(section) && matchesPrefix(pathname, prefix)
    )
}

export interface PromoPopupInput {
    isActive: boolean
    eyebrow: string | null
    kicker: string | null
    title: string
    description: string | null
    imageUrl: string | null
    linkUrl: string | null
    linkLabel: string | null
    mediaCaption: string | null
    sections: string[]
}

export type PromoPopupErrors = Partial<Record<keyof PromoPopupInput, string>>

function isAbsoluteHttpUrl(value: string): boolean {
    try {
        const parsed = new URL(value)
        return parsed.protocol === "http:" || parsed.protocol === "https:"
    } catch {
        return false
    }
}

// `buildLocalPublicUrl` en storage.ts devuelve una ruta root-relativa
// (`/uploads/...`) cuando el proveedor de almacenamiento cae a `local` y no
// hay NEXT_PUBLIC_APP_URL configurado (caso tipico en dev). Se acepta esa
// forma para imageUrl, pero solo si empieza con un unico "/": "//evil.com" es
// una URL protocol-relative que apunta a otro host y debe seguir rechazada.
function isRootRelativePath(value: string): boolean {
    return value.startsWith("/") && !value.startsWith("//")
}

function isBlank(value: string | null | undefined): boolean {
    return !value || value.trim().length === 0
}

/**
 * Valida la config del popup. Solo exige contenido cuando esta activo: un
 * popup apagado puede quedarse a medio llenar sin bloquear el guardado.
 */
export function validatePromoPopupInput(input: PromoPopupInput): PromoPopupErrors {
    const errors: PromoPopupErrors = {}

    if (input.isActive && isBlank(input.title)) {
        errors.title = "El título es obligatorio para activar el popup."
    }

    if (input.isActive && input.sections.length === 0) {
        errors.sections = "Elige al menos una sección donde mostrar el popup."
    }

    const unknown = input.sections.filter(
        (section) => !(PROMO_SECTIONS as readonly string[]).includes(section)
    )
    if (unknown.length > 0) {
        errors.sections = `Sección no válida: ${unknown.join(", ")}.`
    }

    if (!isBlank(input.linkUrl) && !isAbsoluteHttpUrl(input.linkUrl!.trim())) {
        errors.linkUrl = "El enlace debe ser una URL completa que empiece con http:// o https://."
    }

    if (!isBlank(input.linkUrl) && isBlank(input.linkLabel)) {
        errors.linkLabel = "Escribe el texto del botón, por ejemplo \"Ver ahora en YouTube\"."
    }

    if (!isBlank(input.imageUrl)) {
        const trimmedImageUrl = input.imageUrl!.trim()
        if (!isAbsoluteHttpUrl(trimmedImageUrl) && !isRootRelativePath(trimmedImageUrl)) {
            errors.imageUrl = "La imagen debe ser una URL completa que empiece con http:// o https://."
        }
    }

    return errors
}
