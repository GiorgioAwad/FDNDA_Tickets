import Image from "next/image"
import { cn } from "@/lib/utils"

type EventBannerMediaProps = {
    src: string
    alt: string
    className?: string
    sizes?: string
    priority?: boolean
}

const SAFE_REMOTE_HOSTS = [
    "blob.vercel-storage.com",
    "ticketingfdnda.pe",
    "localhost",
    "127.0.0.1",
]

function canUseNextImage(src: string): boolean {
    if (!src) return false
    if (src.startsWith("/")) return true

    try {
        const url = new URL(src)
        if (url.protocol !== "https:" && url.protocol !== "http:") return false

        const hostname = url.hostname.toLowerCase()

        return (
            SAFE_REMOTE_HOSTS.includes(hostname) ||
            hostname.endsWith(".public.blob.vercel-storage.com") ||
            hostname.endsWith(".fdnda.org.pe")
        )
    } catch {
        return false
    }
}

export function EventBannerMedia({
    src,
    alt,
    className,
    sizes,
    priority = false,
}: EventBannerMediaProps) {
    const mergedClassName = cn("absolute inset-0 h-full w-full object-cover", className)

    if (canUseNextImage(src)) {
        return (
            <Image
                src={src}
                alt={alt}
                fill
                priority={priority}
                sizes={sizes}
                className={mergedClassName}
            />
        )
    }

    return (
        <img
            src={src}
            alt={alt}
            className={mergedClassName}
            loading={priority ? "eager" : "lazy"}
        />
    )
}
