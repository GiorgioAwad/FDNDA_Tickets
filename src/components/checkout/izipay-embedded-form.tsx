"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Loader2 } from "lucide-react"

interface IzipayEmbeddedFormProps {
    formToken: string
    publicKey: string
    orderId: string
    onSuccess?: () => void
    onError?: (message: string) => void
}

const IZIPAY_STATIC_URL = "https://static.micuentaweb.pe"

export default function IzipayEmbeddedForm({
    formToken,
    publicKey,
    orderId,
    onSuccess,
    onError,
}: IzipayEmbeddedFormProps) {
    const router = useRouter()
    const containerRef = useRef<HTMLDivElement>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const krRef = useRef<unknown>(null)

    const handleValidate = useCallback(
        async (krAnswer: string, krHash: string) => {
            try {
                const response = await fetch("/api/payments/izipay/validate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        "kr-answer": krAnswer,
                        "kr-hash": krHash,
                    }),
                })

                const data = await response.json()

                if (!response.ok || !data.success) {
                    const msg = data.error || "Error al validar el pago"
                    setError(msg)
                    onError?.(msg)
                    return
                }

                if (data.data?.status === "PAID") {
                    onSuccess?.()
                    router.push(`/checkout/success?orderId=${orderId}`)
                } else if (data.data?.status === "CANCELLED" || data.data?.status === "ERROR") {
                    setError("El pago fue cancelado o rechazado")
                    onError?.("El pago fue cancelado o rechazado")
                }
            } catch (err) {
                const msg = (err as Error).message || "Error de conexion"
                setError(msg)
                onError?.(msg)
            }
        },
        [orderId, router, onSuccess, onError]
    )

    useEffect(() => {
        let mounted = true

        const initForm = async () => {
            try {
                const KRGlueModule = await import("@lyracom/embedded-form-glue")
                const KRGlue = KRGlueModule.default || KRGlueModule

                const { KR } = await KRGlue.loadLibrary(IZIPAY_STATIC_URL, publicKey)

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const kr = KR as any
                krRef.current = kr

                await kr.setFormConfig({
                    formToken,
                    "kr-language": "es-ES",
                })

                const { result } = await kr.attachForm("#izipay-embedded-container")

                await kr.showForm(result.formId)

                kr.onSubmit(async (paymentData: { clientAnswer: unknown; hash: string }) => {
                    const rawAnswer = JSON.stringify(paymentData.clientAnswer)
                    await handleValidate(rawAnswer, paymentData.hash)
                })

                if (mounted) {
                    setLoading(false)
                }
            } catch (err) {
                console.error("Izipay embedded form init error:", err)
                if (mounted) {
                    setError("No se pudo cargar el formulario de pago")
                    setLoading(false)
                }
            }
        }

        initForm()

        return () => {
            mounted = false
        }
    }, [formToken, publicKey, handleValidate])

    return (
        <div className="space-y-4">
            {loading && (
                <div className="flex items-center justify-center py-12 text-gray-500">
                    <Loader2 className="h-6 w-6 animate-spin mr-2" />
                    <span className="text-sm">Cargando formulario de pago...</span>
                </div>
            )}

            {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <div
                id="izipay-embedded-container"
                ref={containerRef}
                className={loading ? "hidden" : ""}
            >
                <div className="kr-embedded" kr-form-token={formToken} />
            </div>

            <div className="text-xs text-gray-500 text-center">
                Pagos procesados de forma segura por IZIPAY
            </div>
        </div>
    )
}
