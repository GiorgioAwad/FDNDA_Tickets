"use client"

import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
    isBlockedPromoPath,
    isPromoVisibleOnPath,
    type PromoEventKind,
} from "@/lib/promo-popup"
import { PromoPopupCard, type PromoPopupCardData } from "./PromoPopupCard"

interface PromoApiPayload extends PromoPopupCardData {
    sections: string[]
    version: string
}

export default function PromoPopup() {
    const pathname = usePathname()
    const closeButtonRef = useRef<HTMLButtonElement>(null)
    const [promo, setPromo] = useState<PromoApiPayload | null>(null)
    const [isDismissed, setIsDismissed] = useState(false)
    const hasFetchedRef = useRef(false)
    const isMountedRef = useRef(true)
    const trackedImpressionVersionRef = useRef<string | null>(null)
    const promoSessionRef = useRef<{ version: string; id: string } | null>(null)

    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    // A lo sumo una peticion por montaje (hasFetchedRef). MainLayoutWrapper
    // monta este componente una sola vez y lo mantiene montado al navegar
    // entre rutas no-admin, asi que si la sesion arranca en una ruta
    // bloqueada (checkout, scanner, tesoreria, login, etc.) hay que seguir
    // reaccionando a los cambios de pathname: recien cuando el usuario entra
    // a una ruta elegible se pide la API, una unica vez. Es la ruta publica
    // de mayor volumen y el VPS es de 1 vCPU.
    useEffect(() => {
        if (hasFetchedRef.current) return
        if (isBlockedPromoPath(pathname)) return
        hasFetchedRef.current = true

        fetch("/api/promo-popup")
            .then((res) => (res.ok ? res.json() : null))
            .then((result) => {
                if (!isMountedRef.current || !result?.promo) return

                const fetchedPromo: PromoApiPayload = result.promo

                // Se lee sessionStorage aca, antes de pintar nada, para que el
                // primer render con `promo` ya poblado traiga el estado de cierre
                // correcto. Si esto viviera en un efecto aparte que reacciona a la
                // llegada del promo, habria un render intermedio con el modal
                // abierto (scroll bloqueado, foco robado) que recien se cerraria
                // en el siguiente ciclo.
                let dismissed = false
                try {
                    const storageKey = `fdnda-promo-${fetchedPromo.version}`
                    dismissed = Boolean(window.sessionStorage.getItem(storageKey))
                } catch {
                    // El popup sigue funcionando aunque el navegador bloquee sessionStorage.
                }

                setPromo(fetchedPromo)
                setIsDismissed(dismissed)
            })
            .catch(() => {
                // Si falla, simplemente no se muestra el popup.
            })
    }, [pathname])

    // La clave depende de la version (el updatedAt de la fila): si el admin
    // edita el contenido, el popup vuelve a salir aunque ya lo hubieran cerrado.
    const storageKey = promo ? `fdnda-promo-${promo.version}` : null

    const getPromoSessionId = useCallback((version: string) => {
        if (promoSessionRef.current?.version === version) return promoSessionRef.current.id

        const sessionKey = `fdnda-promo-session-${version}`
        let sessionId: string | null = null
        try {
            sessionId = window.sessionStorage.getItem(sessionKey)
        } catch {
            // Se usa un ID solo en memoria si sessionStorage no esta disponible.
        }

        if (!sessionId) {
            sessionId =
                typeof window.crypto?.randomUUID === "function"
                    ? window.crypto.randomUUID()
                    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`
            try {
                window.sessionStorage.setItem(sessionKey, sessionId)
            } catch {
                // La medicion sigue siendo idempotente durante este montaje.
            }
        }

        promoSessionRef.current = { version, id: sessionId }
        return sessionId
    }, [])

    const trackPromoEvent = useCallback(
        (kind: PromoEventKind, source: string) => {
            if (!promo) return

            void fetch("/api/promo-popup/events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    version: promo.version,
                    sessionId: getPromoSessionId(promo.version),
                    kind,
                    source,
                    pathname,
                }),
                keepalive: true,
            }).catch(() => {
                // La telemetria nunca bloquea ni muestra errores al visitante.
            })
        },
        [getPromoSessionId, pathname, promo]
    )

    const dismiss = useCallback(() => {
        if (storageKey) {
            try {
                window.sessionStorage.setItem(storageKey, "1")
            } catch {
                // No impedir la navegación si el almacenamiento no está disponible.
            }
        }
        setIsDismissed(true)
    }, [storageKey])

    const closePopup = useCallback(
        (source: "close_button" | "continue_button" | "backdrop" | "escape") => {
            trackPromoEvent("CLOSE", source)
            dismiss()
        },
        [dismiss, trackPromoEvent]
    )

    const followLink = useCallback(
        (source: "media" | "cta") => {
            trackPromoEvent("CLICK", source)
            dismiss()
        },
        [dismiss, trackPromoEvent]
    )

    const isOpen = Boolean(promo) && !isDismissed && isPromoVisibleOnPath(promo?.sections ?? [], pathname)

    useEffect(() => {
        if (!isOpen || !promo || trackedImpressionVersionRef.current === promo.version) return
        trackedImpressionVersionRef.current = promo.version
        trackPromoEvent("IMPRESSION", "automatic")
    }, [isOpen, promo, trackPromoEvent])

    useEffect(() => {
        if (!isOpen) return

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        closeButtonRef.current?.focus()

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") closePopup("escape")
        }

        window.addEventListener("keydown", handleKeyDown)

        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener("keydown", handleKeyDown)
        }
    }, [closePopup, isOpen])

    if (!isOpen || !promo) return null

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
            <button
                type="button"
                aria-label="Cerrar anuncio"
                className="absolute inset-0 cursor-default bg-[#001b38]/85 backdrop-blur-sm"
                onClick={() => closePopup("backdrop")}
            />
            <PromoPopupCard
                data={promo}
                variant="modal"
                onClose={closePopup}
                onLinkClick={followLink}
                closeButtonRef={closeButtonRef}
            />
        </div>
    )
}
