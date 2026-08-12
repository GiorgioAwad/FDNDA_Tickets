"use client"

import Image from "next/image"
import { ExternalLink, Play, X, Youtube } from "lucide-react"
import type { PromoImage } from "@/lib/promo-popup"

export interface PromoPopupCardData {
    eyebrow: string | null
    kicker: string | null
    title: string
    description: string | null
    image: PromoImage
    mediaCaption: string | null
    linkUrl: string | null
    linkLabel: string | null
}

interface PromoPopupCardProps {
    data: PromoPopupCardData
    /** "preview" quita el boton de cerrar: en el admin no hay nada que cerrar. */
    variant?: "modal" | "preview"
    onClose?: () => void
    onLinkClick?: () => void
    closeButtonRef?: React.Ref<HTMLButtonElement>
}

export function PromoPopupCard({
    data,
    variant = "modal",
    onClose,
    onLinkClick,
    closeButtonRef,
}: PromoPopupCardProps) {
    const hasLink = Boolean(data.linkUrl && data.linkLabel)
    const isModal = variant === "modal"

    const media = (
        <>
            {data.image.url ? (
                <Image
                    src={data.image.url}
                    alt={data.title}
                    fill
                    priority
                    unoptimized
                    sizes="(min-width: 768px) 540px, 100vw"
                    className={`${data.image.fit === "cover" ? "object-cover" : "object-contain"} transition duration-500 group-hover:scale-[1.025]`}
                />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/10" />
            {hasLink ? (
                <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white shadow-2xl transition duration-300 group-hover:scale-110 sm:h-20 sm:w-20">
                    <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" aria-hidden="true" />
                </span>
            ) : null}
            {data.mediaCaption ? (
                <span className="absolute bottom-4 left-4 right-4 text-sm font-semibold text-white drop-shadow sm:bottom-5 sm:left-5">
                    {data.mediaCaption}
                </span>
            ) : null}
        </>
    )

    const mediaClassName =
        "group relative min-h-56 overflow-hidden bg-fdnda-primary sm:min-h-72 md:min-h-[500px]"

    return (
        <section
            role={isModal ? "dialog" : undefined}
            aria-modal={isModal ? true : undefined}
            aria-labelledby={isModal ? "promo-popup-title" : undefined}
            aria-describedby={isModal && data.description ? "promo-popup-description" : undefined}
            className="animate-fade-up relative z-10 grid max-h-[calc(100vh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/20 bg-white shadow-2xl md:grid-cols-[1.16fr_0.84fr]"
        >
            {isModal ? (
                <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar anuncio"
                    className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
                >
                    <X className="h-5 w-5" aria-hidden="true" />
                </button>
            ) : null}

            {hasLink ? (
                <a
                    href={data.linkUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onLinkClick}
                    aria-label={`${data.linkLabel}: ${data.title}`}
                    className={mediaClassName}
                >
                    {media}
                </a>
            ) : (
                <div className={mediaClassName}>{media}</div>
            )}

            <div className="flex flex-col justify-center p-5 sm:p-8 md:p-9">
                {data.eyebrow ? (
                    <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-red-600">
                        <Youtube className="h-4 w-4" aria-hidden="true" />
                        {data.eyebrow}
                    </div>
                ) : null}

                {data.kicker ? (
                    <p className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-fdnda-secondary">
                        {data.kicker}
                    </p>
                ) : null}

                <h2
                    id={isModal ? "promo-popup-title" : undefined}
                    className="font-display text-2xl font-bold leading-tight text-fdnda-primary sm:text-3xl"
                >
                    {data.title}
                </h2>

                {data.description ? (
                    <p
                        id={isModal ? "promo-popup-description" : undefined}
                        className="mt-4 text-sm leading-6 text-gray-600 sm:text-base"
                    >
                        {data.description}
                    </p>
                ) : null}

                {hasLink ? (
                    <a
                        href={data.linkUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={onLinkClick}
                        className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:-translate-y-0.5 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                    >
                        {data.linkLabel}
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>
                ) : null}

                {isModal ? (
                    <button
                        type="button"
                        onClick={onClose}
                        className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-primary focus-visible:ring-offset-2"
                    >
                        Seguir viendo entradas
                    </button>
                ) : null}
            </div>
        </section>
    )
}
