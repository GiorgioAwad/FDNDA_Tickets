"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Loader2 } from "lucide-react"
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
                () => reject(new Error("No se pudo cargar el SDK de Izipay")),
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
        script.onerror = () => reject(new Error("No se pudo cargar el SDK de Izipay"))

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
    const mode = config.render?.typeForm === "embedded" ? "embedded" : "redirect"

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    useEffect(() => {
        if (startedRef.current) {
            return
        }

        const validatePayment = async (paymentResult: IzipayPaymentResponse) => {
            if (handledRef.current) {
                return
            }

            handledRef.current = true
            const sdkMessage =
                paymentResult.messageUser ||
                paymentResult.message ||
                "El pago fue cancelado o rechazado por Izipay"
            const hasSignedResponse = Boolean(paymentResult.payloadHttp && paymentResult.signature)

            try {
                if (!hasSignedResponse) {
                    handledRef.current = false
                    const normalizedMessage = sdkMessage.trim()
                    const shouldShowSdkError =
                        normalizedMessage.length > 0 &&
                        normalizedMessage.toUpperCase() !== "OK"

                    if (shouldShowSdkError) {
                        setError(normalizedMessage)
                        onError?.(normalizedMessage)
                    }
                    return
                }

                const response = await fetch("/api/payments/izipay/validate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ paymentResult }),
                })

                const data = await response.json()

                if (!response.ok || !data.success) {
                    throw new Error(data.error || "No se pudo validar el pago con Izipay")
                }

                if (data.data?.status === "PAID") {
                    onSuccess?.()
                    router.push(`/checkout/success?orderId=${data.data.orderId || orderId}`)
                    return
                }

                const message = data.data?.message || sdkMessage

                setError(message)
                onError?.(message)
                router.push(`/checkout/cancel?orderId=${data.data?.orderId || orderId}`)
            } catch (validationError) {
                handledRef.current = false
                const message =
                    (validationError as Error).message ||
                    "Error validando el pago con Izipay"
                setError(message)
                onError?.(message)
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
                checkout.LoadForm({
                    authorization,
                    keyRSA,
                    callbackResponse: async (paymentResult) => validatePayment(paymentResult),
                })

                if (mountedRef.current) {
                    setLoading(false)
                }
            } catch (sdkError) {
                const message =
                    (sdkError as Error).message ||
                    "No se pudo iniciar el checkout de Izipay"
                if (mountedRef.current) {
                    setError(message)
                    setLoading(false)
                }
                onError?.(message)
            }
        }

        void initCheckout()
    }, [authorization, config, keyRSA, mode, onError, onSuccess, orderId, router, scriptUrl])

    return (
        <div className="space-y-4">
            {loading && (
                <div className="flex items-center justify-center py-10 text-gray-500">
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                    <span className="text-sm">
                        {mode === "embedded"
                            ? "Cargando formulario seguro de Izipay..."
                            : "Redirigiendo al checkout seguro de Izipay..."}
                    </span>
                </div>
            )}

            {error && (
                <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

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
