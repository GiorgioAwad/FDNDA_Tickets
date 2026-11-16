// Vigilante del formulario popup de Izipay.
//
// El SDK (1.13.0) cuelga un spinner a pantalla completa en document.body al
// abrir el popup y solo lo retira cuando el formulario del iframe responde. Si
// el iframe no carga o su aplicación no arranca, el SDK no avisa ni limpia: el
// comprador queda con el spinner girando para siempre. Este vigilante detecta
// ese caso por ausencia de señales del iframe dentro de un plazo.

type MessageListener = (event: { origin: string }) => void

export interface IzipayFormWatchdogTarget {
    addEventListener: (type: "message", listener: MessageListener) => void
    removeEventListener: (type: "message", listener: MessageListener) => void
}

export interface IzipayFormWatchdogOptions {
    timeoutMs: number
    /** Se invoca una sola vez si el formulario no dio señales de vida a tiempo. */
    onTimeout: () => void
    /** Por defecto `window`. */
    target?: IzipayFormWatchdogTarget
    setTimer?: (callback: () => void, ms: number) => unknown
    clearTimer?: (handle: unknown) => void
}

export interface IzipayFormWatchdog {
    stop: () => void
}

/**
 * El formulario de pago vive en un iframe de checkout.izipay.pe (o su sandbox).
 * Se exige https y el dominio exacto para que otro origen no pueda hacerse
 * pasar por un formulario que sí cargó.
 */
export function isIzipayCheckoutOrigin(origin: string): boolean {
    try {
        const url = new URL(origin)
        return (
            url.protocol === "https:" &&
            (url.hostname === "izipay.pe" || url.hostname.endsWith(".izipay.pe"))
        )
    } catch {
        return false
    }
}

/**
 * Cualquier mensaje del iframe de Izipay prueba que su aplicación arrancó (un
 * formulario sano emite IZIPAY_EVENT_LOADED a los pocos segundos). A partir de
 * ahí el formulario tiene su propio botón de cierre y sus propios errores, así
 * que el vigilante se retira.
 */
export function startIzipayFormWatchdog(options: IzipayFormWatchdogOptions): IzipayFormWatchdog {
    const target = options.target ?? (window as unknown as IzipayFormWatchdogTarget)
    // Envueltos en flechas: los temporizadores del navegador exigen `this` global.
    const setTimer =
        options.setTimer ?? ((callback: () => void, ms: number) => globalThis.setTimeout(callback, ms))
    const clearTimer =
        options.clearTimer ??
        ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>))

    let active = true

    const stop = () => {
        if (!active) {
            return
        }
        active = false
        clearTimer(timer)
        target.removeEventListener("message", onMessage)
    }

    const onMessage: MessageListener = (event) => {
        if (isIzipayCheckoutOrigin(event.origin)) {
            stop()
        }
    }

    target.addEventListener("message", onMessage)
    const timer = setTimer(() => {
        if (!active) {
            return
        }
        stop()
        options.onTimeout()
    }, options.timeoutMs)

    return { stop }
}
