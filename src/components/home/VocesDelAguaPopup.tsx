"use client"

import Image from "next/image"
import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { ExternalLink, Play, X, Youtube } from "lucide-react"

const VIDEO_ID = "AbSRrPAz4Zo"
const VIDEO_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`
const VIDEO_THUMBNAIL = `https://i.ytimg.com/vi/${VIDEO_ID}/maxresdefault.jpg`
const SESSION_KEY = `fdnda-promo-voces-del-agua-${VIDEO_ID}`

function isPromoRoute(pathname: string) {
    return pathname === "/" || pathname === "/merch" || pathname.startsWith("/eventos")
}

export default function VocesDelAguaPopup() {
    const pathname = usePathname()
    const closeButtonRef = useRef<HTMLButtonElement>(null)
    const [isOpen, setIsOpen] = useState(false)

    const rememberPopup = useCallback(() => {
        try {
            window.sessionStorage.setItem(SESSION_KEY, "1")
        } catch {
            // No impedir la navegación si el almacenamiento no está disponible.
        }
    }, [])

    const closePopup = useCallback(() => {
        rememberPopup()
        setIsOpen(false)
    }, [rememberPopup])

    const handleWatch = useCallback(() => {
        rememberPopup()
        setIsOpen(false)
    }, [rememberPopup])

    useEffect(() => {
        if (!isPromoRoute(pathname)) return

        try {
            if (window.sessionStorage.getItem(SESSION_KEY)) return
        } catch {
            // El popup sigue funcionando aunque el navegador bloquee sessionStorage.
        }

        const animationFrame = window.requestAnimationFrame(() => setIsOpen(true))
        return () => window.cancelAnimationFrame(animationFrame)
    }, [pathname])

    useEffect(() => {
        if (!isOpen) return

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        closeButtonRef.current?.focus()

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") closePopup()
        }

        window.addEventListener("keydown", handleKeyDown)

        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener("keydown", handleKeyDown)
        }
    }, [closePopup, isOpen])

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
            <button
                type="button"
                aria-label="Cerrar anuncio"
                className="absolute inset-0 cursor-default bg-[#001b38]/85 backdrop-blur-sm"
                onClick={closePopup}
            />

            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="voces-del-agua-title"
                aria-describedby="voces-del-agua-description"
                className="animate-fade-up relative z-10 grid max-h-[calc(100vh-1.5rem)] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/20 bg-white shadow-2xl md:grid-cols-[1.16fr_0.84fr]"
            >
                <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={closePopup}
                    aria-label="Cerrar anuncio"
                    className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-lg backdrop-blur-md transition hover:scale-105 hover:bg-black/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black/50"
                >
                    <X className="h-5 w-5" aria-hidden="true" />
                </button>

                <a
                    href={VIDEO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleWatch}
                    aria-label="Ver Voces del Agua con Rafaela Fernandini en YouTube"
                    className="group relative min-h-56 overflow-hidden bg-fdnda-primary sm:min-h-72 md:min-h-[500px]"
                >
                    <Image
                        src={VIDEO_THUMBNAIL}
                        alt="Rafaela Fernandini en Voces del Agua"
                        fill
                        priority
                        unoptimized
                        sizes="(min-width: 768px) 540px, 100vw"
                        className="object-contain transition duration-500 group-hover:scale-[1.025]"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/5 to-black/10" />
                    <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-white shadow-2xl transition duration-300 group-hover:scale-110 sm:h-20 sm:w-20">
                        <Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9" aria-hidden="true" />
                    </span>
                    <span className="absolute bottom-4 left-4 right-4 text-sm font-semibold text-white drop-shadow sm:bottom-5 sm:left-5">
                        Temporada 1 · Episodio 1
                    </span>
                </a>

                <div className="flex flex-col justify-center p-5 sm:p-8 md:p-9">
                    <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] text-red-600">
                        <Youtube className="h-4 w-4" aria-hidden="true" />
                        Estreno FDNDA
                    </div>

                    <p className="mb-2 text-sm font-bold uppercase tracking-[0.16em] text-fdnda-secondary">
                        Voces del Agua
                    </p>
                    <h2
                        id="voces-del-agua-title"
                        className="font-display text-2xl font-bold leading-tight text-fdnda-primary sm:text-3xl"
                    >
                        Conoce a la nadadora más rápida de la historia del Perú
                    </h2>
                    <p
                        id="voces-del-agua-description"
                        className="mt-4 text-sm leading-6 text-gray-600 sm:text-base"
                    >
                        Rafaela Fernandini comparte el camino detrás de sus récords: disciplina,
                        perseverancia y la pasión de representar al Perú.
                    </p>

                    <a
                        href={VIDEO_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleWatch}
                        className="mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-center text-sm font-bold text-white shadow-lg shadow-red-600/25 transition hover:-translate-y-0.5 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
                    >
                        Ver ahora en YouTube
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>

                    <button
                        type="button"
                        onClick={closePopup}
                        className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fdnda-primary focus-visible:ring-offset-2"
                    >
                        Seguir viendo entradas
                    </button>
                </div>
            </section>
        </div>
    )
}
