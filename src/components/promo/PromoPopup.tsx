"use client"

import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { isPromoVisibleOnPath } from "@/lib/promo-popup"
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

    // Una sola peticion por montaje. No depende de pathname: navegar dentro del
    // sitio no debe volver a pedirla.
    useEffect(() => {
        let cancelled = false

        fetch("/api/promo-popup")
            .then((res) => (res.ok ? res.json() : null))
            .then((result) => {
                if (cancelled || !result?.promo) return
                setPromo(result.promo)
            })
            .catch(() => {
                // Si falla, simplemente no se muestra el popup.
            })

        return () => {
            cancelled = true
        }
    }, [])

    // La clave depende de la version (el updatedAt de la fila): si el admin
    // edita el contenido, el popup vuelve a salir aunque ya lo hubieran cerrado.
    const storageKey = promo ? `fdnda-promo-${promo.version}` : null

    useEffect(() => {
        if (!storageKey) return
        try {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of persisted UI preference
            if (window.sessionStorage.getItem(storageKey)) setIsDismissed(true)
        } catch {
            // El popup sigue funcionando aunque el navegador bloquee sessionStorage.
        }
    }, [storageKey])

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

    const isOpen = Boolean(promo) && !isDismissed && isPromoVisibleOnPath(promo?.sections ?? [], pathname)

    useEffect(() => {
        if (!isOpen) return

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        closeButtonRef.current?.focus()

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") dismiss()
        }

        window.addEventListener("keydown", handleKeyDown)

        return () => {
            document.body.style.overflow = previousOverflow
            window.removeEventListener("keydown", handleKeyDown)
        }
    }, [dismiss, isOpen])

    if (!isOpen || !promo) return null

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-6">
            <button
                type="button"
                aria-label="Cerrar anuncio"
                className="absolute inset-0 cursor-default bg-[#001b38]/85 backdrop-blur-sm"
                onClick={dismiss}
            />
            <PromoPopupCard
                data={promo}
                variant="modal"
                onClose={dismiss}
                onLinkClick={dismiss}
                closeButtonRef={closeButtonRef}
            />
        </div>
    )
}
