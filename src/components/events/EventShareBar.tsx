"use client"

import * as React from "react"
import { toast } from "sonner"
import { Share2, Link2, Facebook, Twitter, MessageCircle } from "lucide-react"

interface EventShareBarProps {
    title: string
    url: string
}

export function EventShareBar({ title, url }: EventShareBarProps) {
    const fullUrl = typeof window === "undefined" ? url : new URL(url, window.location.origin).toString()

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(fullUrl)
            toast.success("Enlace copiado")
        } catch {
            toast.error("No se pudo copiar el enlace")
        }
    }

    const shareNative = async () => {
        if (typeof navigator !== "undefined" && navigator.share) {
            try {
                await navigator.share({ title, url: fullUrl })
            } catch {
                /* user cancelled */
            }
        } else {
            await copyLink()
        }
    }

    const links = {
        whatsapp: `https://wa.me/?text=${encodeURIComponent(`${title} - ${fullUrl}`)}`,
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(fullUrl)}`,
        twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(fullUrl)}`,
    }

    return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
                <Share2 className="h-4 w-4" /> Compartir:
            </span>
            <button
                onClick={shareNative}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted hover:bg-fdnda-primary hover:text-white transition-colors text-xs font-medium"
                aria-label="Compartir"
            >
                <Share2 className="h-3.5 w-3.5" /> Compartir
            </button>
            <a
                href={links.whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted hover:bg-[#25D366] hover:text-white transition-colors text-xs font-medium"
            >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
            <a
                href={links.facebook}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted hover:bg-[#1877F2] hover:text-white transition-colors text-xs font-medium"
            >
                <Facebook className="h-3.5 w-3.5" /> Facebook
            </a>
            <a
                href={links.twitter}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted hover:bg-black hover:text-white transition-colors text-xs font-medium"
            >
                <Twitter className="h-3.5 w-3.5" /> X
            </a>
            <button
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 bg-muted hover:bg-fdnda-primary hover:text-white transition-colors text-xs font-medium"
            >
                <Link2 className="h-3.5 w-3.5" /> Copiar enlace
            </button>
        </div>
    )
}
