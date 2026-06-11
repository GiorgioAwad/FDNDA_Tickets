"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import * as Sentry from "@sentry/nextjs"
import {
    IZIPAY_EMBEDDED_CONTAINER_ID,
    type IzipayCheckoutConfig,
} from "@/lib/izipay"

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
            }) => void
        }
    }
}

const SDK_LOAD_ERROR_MESSAGE =
    "No pudimos cargar el método de pago. Suele deberse a un bloqueador de anuncios, una extensión del navegador o tu red. Prueba: desactivar extensiones, usar modo incógnito o cambiar de navegador, y vuelve a intentar."

const GENERIC_PAYMENT_ERROR_MESSAGE =
    "Izipay no pudo procesar el pago en este momento. Vuelve a intentarlo; si persiste, prueba con otro navegador o tarjeta."

const REDIRECT_TIMEOUT_MESSAGE =
    "No pudimos redirigirte a la pasarela de Izipay. Vuelve a intentarlo; si persiste, desactiva extensiones del navegador o prueba en modo incógnito."

// Tiempo máximo esperando que el SDK nos lleve a la página de pago de Izipay.
// Si no navegó en este lapso, el SDK rechazó el config silenciosamente (en modo
// redirect no reporta errores) y sin esto el usuario queda en un spinner eterno.
const REDIRECT_WATCHDOG_MS = 20_000

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
        }

        Sentry.captureMessage("izipay-checkout-failure", {
            level: "error",
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

        if (existing?.dataset.loaded === "true") {
            resolve()
            return
        }

        if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true })
            existing.addEventListener(
                "error",
                () => reject(new Error(SDK_LOAD_ERROR_MESSAGE)),
                { once: true }
            )
            return
        }

        const script = document.createElement("script")
        script.src = src
        script.async = true
        script.defer = true
        script.dataset.izipaySdk = "true"
        script.onload = () => {
            script.dataset.loaded = "true"
            resolve()
        }
        script.onerror = () => {
            script.remove()
            reject(new Error(SDK_LOAD_ERROR_MESSAGE))
        }

        document.head.appendChild(script)
    })
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
    const redirectWatchdogRef = useRef<number | null>(null)
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

    useEffect(() => {
        mountedRef.current = true
        window.addEventListener("pagehide", clearRedirectWatchdog)
        return () => {
            mountedRef.current = false
            window.removeEventListener("pagehide", clearRedirectWatchdog)
            clearRedirectWatchdog()
        }
    }, [clearRedirectWatchdog])

    useEffect(() => {
        if (startedRef.current) {
            return
        }

        const validatePayment = async (paymentResult: IzipayPaymentResponse) => {
            if (handledRef.current) {
                return
            }

            clearRedirectWatchdog()
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

        const initCheckout = async () => {
            try {
                startedRef.current = true
                await loadIzipayScript(scriptUrl)

                if (typeof window.Izipay !== "function") {
                    throw new Error("El SDK de Izipay no se inicializo correctamente")
                }

                const checkout = new window.Izipay({ config })
                if (mode === "redirect") {
                    // La doc dice que callbackResponse "no aplica" en redirect,
                    // pero si el SDK rechaza el config ANTES de navegar es la
                    // unica via para enterarnos del motivo; el watchdog cubre el
                    // caso en que ni siquiera invoque el callback (spinner eterno).
                    checkout.LoadForm({
                        authorization,
                        keyRSA,
                        callbackResponse: async (paymentResult) => validatePayment(paymentResult),
                    })
                    redirectWatchdogRef.current = window.setTimeout(() => {
                        if (!mountedRef.current || handledRef.current) {
                            return
                        }
                        console.error(
                            "Izipay redirect no navego tras",
                            REDIRECT_WATCHDOG_MS,
                            "ms; config rechazado o red bloqueada"
                        )
                        setError(REDIRECT_TIMEOUT_MESSAGE)
                        setLoading(false)
                        onError?.(REDIRECT_TIMEOUT_MESSAGE)
                        void reportCheckoutFailure({
                            orderId,
                            stage: "redirect-timeout",
                            mode,
                            message: `sin navegacion tras ${REDIRECT_WATCHDOG_MS}ms`,
                            scriptUrl,
                        })
                    }, REDIRECT_WATCHDOG_MS)
                } else {
                    checkout.LoadForm({
                        authorization,
                        keyRSA,
                        callbackResponse: async (paymentResult) => validatePayment(paymentResult),
                    })
                }

                // En redirect el spinner se mantiene hasta que el navegador
                // navegue a Izipay (o el watchdog reporte el fallo).
                if (mountedRef.current && mode !== "redirect") {
                    setLoading(false)
                }
            } catch (sdkError) {
                const rawMessage = (sdkError as Error).message
                const message =
                    rawMessage === SDK_LOAD_ERROR_MESSAGE
                        ? rawMessage
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
                        rawMessage === SDK_LOAD_ERROR_MESSAGE
                            ? "sdk-script-load"
                            : "sdk-init",
                    mode,
                    message: (rawMessage || "").slice(0, 300),
                    scriptUrl,
                })
            }
        }

        void initCheckout()
    }, [authorization, clearRedirectWatchdog, config, keyRSA, mode, onError, onSuccess, orderId, router, scriptUrl])

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
