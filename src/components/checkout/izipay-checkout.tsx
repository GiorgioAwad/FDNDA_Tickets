"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import * as Sentry from "@sentry/nextjs"
import {
    IZIPAY_EMBEDDED_CONTAINER_ID,
    type IzipayCheckoutConfig,
} from "@/lib/izipay"
import { isIzipayUserCancellationMessage } from "@/lib/izipay-client-response"
import { startIzipayFormWatchdog, type IzipayFormWatchdog } from "@/lib/izipay-form-watchdog"

interface IzipayCheckoutProps {
    authorization: string
    keyRSA: string
    scriptUrl: string
    config: IzipayCheckoutConfig
    orderId: string
    onSuccess?: () => void
    onError?: (message: string) => void
}

type IzipayPaymentResponse = {
    code?: string
    message?: string
    messageUser?: string
    messageUserEng?: string
    payloadHttp?: string
    signature?: string
    transactionId?: string
    response?: {
        order?: Array<{
            orderNumber?: string
        }>
    }
}

declare global {
    interface Window {
        Izipay?: new (options: { config: IzipayCheckoutConfig }) => {
            LoadForm: (options: {
                authorization: string
                keyRSA: string
                callbackResponse?: (response: IzipayPaymentResponse) => void | Promise<void>
            }) => void | Promise<void>
            destroy?: () => void
        }
    }
}

type IzipayCheckoutInstance = InstanceType<NonNullable<Window["Izipay"]>>

const SDK_LOAD_ERROR_MESSAGE =
    "No pudimos cargar el método de pago. Suele deberse a un bloqueador de anuncios, una extensión del navegador o tu red. Prueba: desactivar extensiones, usar modo incógnito o cambiar de navegador, y vuelve a intentar."

const GENERIC_PAYMENT_ERROR_MESSAGE =
    "Izipay no pudo procesar el pago en este momento. Vuelve a intentarlo; si persiste, prueba con otro navegador o tarjeta."

const PAYMENT_FORM_CLOSED_MESSAGE =
    "Cerraste el formulario de pago. Puedes intentarlo nuevamente."

const REDIRECT_TIMEOUT_MESSAGE =
    "No pudimos redirigirte a la pasarela de Izipay. Vuelve a intentarlo; si persiste, desactiva extensiones del navegador o prueba en modo incógnito."

const FORM_LOAD_FAILED_MESSAGE =
    "El formulario de pago de Izipay no terminó de cargar, así que no se realizó ningún cobro. Vuelve a intentarlo; si persiste, revisa tu conexión, desactiva bloqueadores de anuncios o prueba con otro navegador."

// Tiempo máximo esperando que el SDK nos lleve a la página de pago de Izipay.
// Si no navegó en este lapso, el SDK rechazó el config silenciosamente (en modo
// redirect no reporta errores) y sin esto el usuario queda en un spinner eterno.
const REDIRECT_WATCHDOG_MS = 20_000
// Tiempo máximo esperando la primera señal del formulario popup. Un formulario
// sano responde en ~5s con buena conexión; el margen cubre redes móviles lentas.
// Sin esto, si el iframe de Izipay no arranca, el spinner a pantalla completa
// del SDK se queda girando para siempre y tapa toda la página.
const POPUP_FORM_WATCHDOG_MS = 30_000
const SDK_LOAD_TIMEOUT_MS = 8_000
const FIRST_PARTY_SDK_PATH = "/api/checkout/runtime"

// El SDK de Izipay a veces devuelve como "mensaje" un payload técnico (JSON,
// HTML o un blob firmado). Eso nunca debe llegar a la pantalla del comprador.
function sanitizeIzipayUserMessage(raw: string | undefined | null): string {
    const message = (raw || "").trim()

    if (!message) {
        return GENERIC_PAYMENT_ERROR_MESSAGE
    }

    const looksTechnical =
        message.length > 160 ||
        /^[{[<]/.test(message) ||
        message.includes("payloadHttp") ||
        message.includes("<html") ||
        /[A-Za-z0-9+/=_-]{40,}/.test(message) ||
        /[\u0000-\u001F\uFFFD]/.test(message)

    if (looksTechnical) {
        console.error("Izipay devolvió un mensaje no legible para el usuario:", message)
        return GENERIC_PAYMENT_ERROR_MESSAGE
    }

    return message
}

// Sonda de conectividad desde el navegador del comprador. no-cors: solo nos
// interesa si el dispositivo ALCANZA el servidor (DNS/TCP/TLS), no el contenido.
async function probeUrl(url: string, timeoutMs = 6000): Promise<string> {
    const start = Date.now()
    try {
        const controller = new AbortController()
        const timer = window.setTimeout(() => controller.abort(), timeoutMs)
        await fetch(url, { mode: "no-cors", cache: "no-store", signal: controller.signal })
        window.clearTimeout(timer)
        return `ok/${Date.now() - start}ms`
    } catch (error) {
        return `FAIL/${Date.now() - start}ms/${(error as Error).name || "Error"}`
    }
}

// El SDK redirect de Izipay falla sin callback ni excepcion, asi que cada fallo
// se reporta al backend (docker logs) y a Sentry con sondas que dicen si el
// dispositivo del comprador llega a checkout.izipay.pe y api-pw.izipay.pe.
async function reportCheckoutFailure(input: {
    orderId: string
    stage: string
    mode: string
    message: string
    scriptUrl: string
    severity?: "error" | "warning"
}) {
    try {
        const [sdkProbe, apiProbe] = await Promise.all([
            probeUrl(input.scriptUrl),
            probeUrl("https://api-pw.izipay.pe/"),
        ])
        const payload = {
            orderId: input.orderId,
            stage: input.stage,
            mode: input.mode,
            message: input.message,
            probes: { sdk: sdkProbe, api: apiProbe },
            severity: input.severity || "error",
        }

        Sentry.captureMessage("izipay-checkout-failure", {
            level: input.severity || "error",
            extra: payload,
        })

        void fetch("/api/payments/izipay/client-log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify(payload),
        }).catch(() => {})
    } catch {
        // La telemetria nunca debe romper el checkout.
    }
}

function loadIzipayScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(
            `script[data-izipay-sdk="true"][src="${src}"]`
        )

        if (existing?.dataset.loaded === "true" && typeof window.Izipay === "function") {
            resolve()
            return
        }

        if (existing) {
            existing.remove()
        }

        const script = document.createElement("script")
        const timeoutId = window.setTimeout(() => {
            script.remove()
            reject(new Error(`Timeout cargando SDK desde ${new URL(src, window.location.href).host}`))
        }, SDK_LOAD_TIMEOUT_MS)

        script.src = src
        script.async = true
        script.defer = true
        script.dataset.izipaySdk = "true"
        script.onload = () => {
            window.clearTimeout(timeoutId)
            script.dataset.loaded = "true"

            if (typeof window.Izipay === "function") {
                resolve()
                return
            }

            script.remove()
            reject(new Error("El SDK cargo sin exponer window.Izipay"))
        }
        script.onerror = () => {
            window.clearTimeout(timeoutId)
            script.remove()
            reject(new Error(`No se pudo descargar el SDK desde ${new URL(src, window.location.href).host}`))
        }

        document.head.appendChild(script)
    })
}

async function loadIzipayScriptWithFallback(
    primarySrc: string,
    mode: "embedded" | "redirect" | "popup"
): Promise<string[]> {
    if (typeof window.Izipay === "function") {
        return []
    }

    const firstPartySrc = `${FIRST_PARTY_SDK_PATH}?mode=${encodeURIComponent(mode)}`
    const sources = Array.from(new Set([firstPartySrc, primarySrc]))
    const failures: string[] = []

    for (const source of sources) {
        try {
            await loadIzipayScript(source)
            return failures
        } catch (error) {
            failures.push(`${source}: ${(error as Error).message}`)
        }
    }

    throw new Error(`${SDK_LOAD_ERROR_MESSAGE} Intentos: ${failures.join(" | ")}`)
}

export default function IzipayCheckout({
    authorization,
    keyRSA,
    scriptUrl,
    config,
    orderId,
    onSuccess,
    onError,
}: IzipayCheckoutProps) {
    const router = useRouter()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const mountedRef = useRef(true)
    const startedRef = useRef(false)
    const handledRef = useRef(false)
    const failedRef = useRef(false)
    const redirectWatchdogRef = useRef<number | null>(null)
    const formWatchdogRef = useRef<IzipayFormWatchdog | null>(null)
    const checkoutRef = useRef<IzipayCheckoutInstance | null>(null)
    const mode =
        config.render?.typeForm === "embedded"
            ? "embedded"
            : config.render?.typeForm === "redirect"
                ? "redirect"
                : "popup"

    const clearRedirectWatchdog = useCallback(() => {
        if (redirectWatchdogRef.current !== null) {
            window.clearTimeout(redirectWatchdogRef.current)
            redirectWatchdogRef.current = null
        }
    }, [])

    // Retira lo que el SDK colgó en document.body (spinner a pantalla completa e
    // iframe). El SDK no lo limpia por su cuenta cuando falla, y como vive fuera
    // de este componente tampoco desaparece al desmontarlo.
    const teardownCheckout = useCallback(() => {
        formWatchdogRef.current?.stop()
        formWatchdogRef.current = null

        const checkout = checkoutRef.current
        checkoutRef.current = null
        try {
            checkout?.destroy?.()
        } catch (destroyError) {
            console.error("No se pudo cerrar el checkout de Izipay:", destroyError)
        }
    }, [])

    useEffect(() => {
        mountedRef.current = true
        window.addEventListener("pagehide", clearRedirectWatchdog)
        return () => {
            mountedRef.current = false
            window.removeEventListener("pagehide", clearRedirectWatchdog)
            clearRedirectWatchdog()
            teardownCheckout()
        }
    }, [clearRedirectWatchdog, teardownCheckout])

    useEffect(() => {
        if (startedRef.current) {
            return
        }

        const validatePayment = async (paymentResult: IzipayPaymentResponse) => {
            if (handledRef.current) {
                return
            }

            clearRedirectWatchdog()
            // Si el SDK ya respondió, el formulario cargó: el vigilante sobra.
            formWatchdogRef.current?.stop()
            handledRef.current = true
            const rawSdkMessage = (
                paymentResult.messageUser ||
                paymentResult.message ||
                ""
            ).trim()
            const hasSignedResponse = Boolean(paymentResult.payloadHttp && paymentResult.signature)

            try {
                if (!hasSignedResponse) {
                    handledRef.current = false
                    const shouldShowSdkError =
                        rawSdkMessage.length > 0 &&
                        rawSdkMessage.toUpperCase() !== "OK"

                    if (shouldShowSdkError) {
                        if (isIzipayUserCancellationMessage(rawSdkMessage)) {
                            Sentry.addBreadcrumb({
                                category: "payment",
                                message: "Izipay checkout cerrado por el usuario",
                                level: "info",
                                data: { orderId, mode },
                            })
                            setError(PAYMENT_FORM_CLOSED_MESSAGE)
                            onError?.(PAYMENT_FORM_CLOSED_MESSAGE)
                            return
                        }

                        const message = sanitizeIzipayUserMessage(rawSdkMessage)
                        setError(message)
                        onError?.(message)
                        void reportCheckoutFailure({
                            orderId,
                            stage: "sdk-callback-error",
                            mode,
                            message: rawSdkMessage.slice(0, 300),
                            scriptUrl,
                        })
                    }
                    return
                }

                const response = await fetch("/api/payments/izipay/validate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ paymentResult }),
                })

                const data = await response.json()

                if (data.processing) {
                    onSuccess?.()
                    router.push(`/checkout/success?orderId=${orderId}`)
                    return
                }

                if (response.status === 503) {
                    onSuccess?.()
                    router.push(`/checkout/success?orderId=${orderId}`)
                    return
                }

                if (!response.ok || !data.success) {
                    throw new Error(data.error || "No se pudo validar el pago con Izipay")
                }

                if (data.data?.status === "PAID") {
                    onSuccess?.()
                    router.push(`/checkout/success?orderId=${data.data.orderId || orderId}`)
                    return
                }

                if (data.data?.status === "PENDING") {
                    onSuccess?.()
                    router.push(`/checkout/success?orderId=${data.data.orderId || orderId}`)
                    return
                }

                const message = sanitizeIzipayUserMessage(
                    data.data?.message ||
                    rawSdkMessage ||
                    "El pago fue cancelado o rechazado por Izipay"
                )

                setError(message)
                onError?.(message)
                router.push(`/checkout/cancel?orderId=${data.data?.orderId || orderId}`)
            } catch (validationError) {
                handledRef.current = false
                const message = sanitizeIzipayUserMessage(
                    (validationError as Error).message ||
                    "Error validando el pago con Izipay"
                )
                setError(message)
                onError?.(message)
                void reportCheckoutFailure({
                    orderId,
                    stage: "validate-error",
                    mode,
                    message: ((validationError as Error).message || "").slice(0, 300),
                    scriptUrl,
                })
                // Redirect to success so reconciliation polling can resolve the payment
                router.push(`/checkout/success?orderId=${orderId}`)
            } finally {
                if (mountedRef.current) {
                    setLoading(false)
                }
            }
        }

        // El SDK no pudo mostrar el formulario (o no navegó, en redirect). Se
        // retira su spinner, se informa al comprador y vuelve el botón Pagar.
        const failCheckout = (input: { message: string; stage: string; detail: string }) => {
            if (!mountedRef.current || handledRef.current || failedRef.current) {
                return
            }

            failedRef.current = true
            clearRedirectWatchdog()
            teardownCheckout()
            setError(input.message)
            setLoading(false)
            onError?.(input.message)
            void reportCheckoutFailure({
                orderId,
                stage: input.stage,
                mode,
                message: input.detail.slice(0, 300),
                scriptUrl,
            })
        }

        const initCheckout = async () => {
            try {
                startedRef.current = true
                const failedSources = await loadIzipayScriptWithFallback(scriptUrl, mode)

                if (failedSources.length > 0) {
                    void reportCheckoutFailure({
                        orderId,
                        stage: "sdk-fallback-recovered",
                        mode,
                        message: failedSources.join(" | ").slice(0, 300),
                        scriptUrl,
                        severity: "warning",
                    })
                }

                if (typeof window.Izipay !== "function") {
                    throw new Error("El SDK de Izipay no se inicializo correctamente")
                }

                // Si el componente se desmontó mientras bajaba el SDK, abrir el
                // formulario dejaría su spinner huérfano sobre la página.
                if (!mountedRef.current) {
                    return
                }

                const checkout = new window.Izipay({ config })
                checkoutRef.current = checkout

                // LoadForm es async: si falla rechaza la promesa en vez de lanzar,
                // y el SDK deja su spinner a pantalla completa puesto.
                const loadForm = () => {
                    void Promise.resolve(
                        checkout.LoadForm({
                            authorization,
                            keyRSA,
                            callbackResponse: async (paymentResult) => validatePayment(paymentResult),
                        })
                    ).catch((loadError: unknown) => {
                        const detail = (loadError as Error)?.message || String(loadError)
                        console.error("Izipay LoadForm fallo:", detail)
                        failCheckout({
                            message:
                                mode === "redirect"
                                    ? REDIRECT_TIMEOUT_MESSAGE
                                    : FORM_LOAD_FAILED_MESSAGE,
                            stage: "sdk-loadform-rejected",
                            detail,
                        })
                    })
                }

                if (mode === "redirect") {
                    // La doc dice que callbackResponse "no aplica" en redirect,
                    // pero si el SDK rechaza el config ANTES de navegar es la
                    // unica via para enterarnos del motivo; el watchdog cubre el
                    // caso en que ni siquiera invoque el callback (spinner eterno).
                    loadForm()
                    redirectWatchdogRef.current = window.setTimeout(() => {
                        console.error(
                            "Izipay redirect no navego tras",
                            REDIRECT_WATCHDOG_MS,
                            "ms; config rechazado o red bloqueada"
                        )
                        failCheckout({
                            message: REDIRECT_TIMEOUT_MESSAGE,
                            stage: "redirect-timeout",
                            detail: `sin navegacion tras ${REDIRECT_WATCHDOG_MS}ms`,
                        })
                    }, REDIRECT_WATCHDOG_MS)
                } else {
                    if (mode === "popup") {
                        // Se arma ANTES de LoadForm para no perder la primera señal.
                        formWatchdogRef.current = startIzipayFormWatchdog({
                            timeoutMs: POPUP_FORM_WATCHDOG_MS,
                            onTimeout: () => {
                                console.error(
                                    "El formulario popup de Izipay no dio señales tras",
                                    POPUP_FORM_WATCHDOG_MS,
                                    "ms"
                                )
                                failCheckout({
                                    message: FORM_LOAD_FAILED_MESSAGE,
                                    stage: "popup-form-timeout",
                                    detail: `sin señales del formulario tras ${POPUP_FORM_WATCHDOG_MS}ms`,
                                })
                            },
                        })
                    }
                    loadForm()
                }

                // En redirect el spinner se mantiene hasta que el navegador
                // navegue a Izipay (o el watchdog reporte el fallo).
                if (mountedRef.current && mode !== "redirect") {
                    setLoading(false)
                }
            } catch (sdkError) {
                const rawMessage = (sdkError as Error).message
                const message =
                    rawMessage.startsWith(SDK_LOAD_ERROR_MESSAGE)
                        ? SDK_LOAD_ERROR_MESSAGE
                        : sanitizeIzipayUserMessage(
                            rawMessage || "No se pudo iniciar el checkout de Izipay"
                        )
                if (mountedRef.current) {
                    setError(message)
                    setLoading(false)
                }
                onError?.(message)
                void reportCheckoutFailure({
                    orderId,
                    stage:
                        rawMessage.startsWith(SDK_LOAD_ERROR_MESSAGE)
                            ? "sdk-script-load"
                            : "sdk-init",
                    mode,
                    message: (rawMessage || "").slice(0, 300),
                    scriptUrl,
                })
            }
        }

        void initCheckout()
    }, [authorization, clearRedirectWatchdog, config, keyRSA, mode, onError, onSuccess, orderId, router, scriptUrl, teardownCheckout])

    return (
        <div className="space-y-4">
            {loading && !error && (
                <div className="flex items-center justify-center py-10 text-gray-500">
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                    <span className="text-sm">
                        {mode === "embedded"
                            ? "Cargando formulario seguro de Izipay..."
                            : mode === "redirect"
                                ? "Redirigiendo al checkout seguro de Izipay..."
                                : "Abriendo checkout seguro de Izipay..."}
                    </span>
                </div>
            )}

            {/* El error lo muestra el componente padre via onError(); no duplicarlo aqui */}

            {mode === "embedded" && (
                <div
                    id={IZIPAY_EMBEDDED_CONTAINER_ID}
                    className={loading ? "min-h-[320px] opacity-60" : ""}
                />
            )}

            <div className="text-center text-xs text-gray-500">
                Pagos procesados de forma segura por IZIPAY
            </div>
        </div>
    )
}
