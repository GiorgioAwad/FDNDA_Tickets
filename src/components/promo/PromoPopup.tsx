"use client"

import { usePathname } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { isBlockedPromoPath, isPromoVisibleOnPath } from "@/lib/promo-popup"
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
