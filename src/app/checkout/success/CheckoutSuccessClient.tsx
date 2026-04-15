"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useCart } from "@/hooks/cart-context"
import { AlertCircle, CheckCircle, Loader2, Ticket, XCircle } from "lucide-react"

type OrderStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"

export default function CheckoutSuccessClient() {
    const searchParams = useSearchParams()
    const orderId = searchParams.get("orderId")
    const { clearCart } = useCart()

    const [status, setStatus] = useState<OrderStatus | null>(null)
    const [eventTitle, setEventTitle] = useState<string | null>(null)
    const [reviewRequired, setReviewRequired] = useState(false)
    const [statusMessage, setStatusMessage] = useState("")
    const [error, setError] = useState("")

    useEffect(() => {
        if (status === "PAID") {
            clearCart()
        }
    }, [clearCart, status])

    useEffect(() => {
        if (!orderId) return

        let active = true
        let attempts = 0
        let timeoutId: ReturnType<typeof setTimeout> | null = null

        const pollOrder = async () => {
            try {
                const response = await fetch(`/api/payments/izipay/status?orderId=${orderId}`, {
                    cache: "no-store",
                })
                const data = await response.json()

                if (!response.ok) {
                    throw new Error(data.error || "Error al consultar la orden")
                }

                if (!active) {
                    return
                }

                setStatus(data.data.status)
                setEventTitle(data.data.eventTitle)
                setReviewRequired(Boolean(data.data.reviewRequired))
                setStatusMessage(data.data.message || "")

                if (
                    data.data.status === "PENDING" &&
                    !data.data.reviewRequired &&
                    attempts < 10
                ) {
                    attempts += 1
                    timeoutId = setTimeout(pollOrder, 3000)
                }
            } catch (err) {
                if (!active) {
                    return
                }

                if (attempts < 10) {
                    attempts += 1
                    timeoutId = setTimeout(pollOrder, 3000)
                    return
                }

                setError((err as Error).message)
            }
        }

        void pollOrder()

        return () => {
            active = false
            if (timeoutId) clearTimeout(timeoutId)
        }
    }, [orderId])

    if (!orderId) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p>Orden no encontrada</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <p>{error}</p>
            </div>
        )
    }

    const isPaid = status === "PAID"
    const isManualReview = status === "PENDING" && reviewRequired
    const isProcessing = status === null || (status === "PENDING" && !reviewRequired)

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center py-8 sm:py-12 px-4">
            <Card className="w-full max-w-md shadow-xl border-0">
                <CardContent className="pt-8 pb-8 text-center sm:pt-10">
                    {isProcessing ? (
                        <>
                            <Loader2 className="h-14 w-14 sm:h-16 sm:w-16 mx-auto text-[hsl(210,100%,40%)] animate-spin mb-4" />
                            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
                                Procesando tu pago...
                            </h2>
                            <p className="text-gray-600">
                                Estamos confirmando tu transaccion
                            </p>
                            {statusMessage ? (
                                <p className="text-sm text-gray-500 mt-3">{statusMessage}</p>
                            ) : null}
                        </>
                    ) : isPaid ? (
                        <>
                            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-green-100 text-green-600 mb-5 sm:mb-6">
                                <CheckCircle className="h-8 w-8 sm:h-10 sm:w-10" />
                            </div>

                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                                Pago exitoso
                            </h1>

                            <p className="text-gray-600 mb-8">
                                Tu orden <strong>#{orderId.slice(-8).toUpperCase()}</strong> ha sido confirmada.
                                {eventTitle ? ` Evento: ${eventTitle}.` : ""}
                                {" "}Hemos enviado los tickets a tu correo electronico.
                            </p>

                            <div className="space-y-5">
                                <Link href="/mi-cuenta/entradas">
                                    <Button className="w-full" size="lg">
                                        <Ticket className="h-4 w-4 mr-2" />
                                        Ver mis entradas
                                    </Button>
                                </Link>

                                <Link href="/eventos">
                                    <Button variant="outline" className="w-full">
                                        Volver a eventos
                                    </Button>
                                </Link>
                            </div>
                        </>
                    ) : isManualReview ? (
                        <>
                            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-amber-100 text-amber-600 mb-5 sm:mb-6">
                                <AlertCircle className="h-8 w-8 sm:h-10 sm:w-10" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                                Pago en validacion
                            </h1>
                            <p className="text-gray-600 mb-8">
                                La orden <strong>#{orderId.slice(-8).toUpperCase()}</strong> sigue
                                en revision manual.
                                {eventTitle ? ` Evento: ${eventTitle}.` : ""}
                                {" "}No vuelvas a pagar por ahora.
                            </p>
                            {statusMessage ? (
                                <p className="text-sm text-gray-500 mb-6">{statusMessage}</p>
                            ) : null}
                            <div className="space-y-3">
                                <Link href="/eventos">
                                    <Button variant="outline" className="w-full">
                                        Volver a eventos
                                    </Button>
                                </Link>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-red-100 text-red-600 mb-5 sm:mb-6">
                                <XCircle className="h-8 w-8 sm:h-10 sm:w-10" />
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                                Pago no completado
                            </h1>
                            <p className="text-gray-600 mb-8">
                                La orden <strong>#{orderId.slice(-8).toUpperCase()}</strong> no pudo confirmarse.
                                Intenta nuevamente o contacta soporte.
                            </p>
                            <div className="space-y-3">
                                <Link href="/eventos">
                                    <Button className="w-full" size="lg">
                                        Volver a eventos
                                    </Button>
                                </Link>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
