"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle, Ticket, Loader2, XCircle } from "lucide-react"

type OrderStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"

export default function CheckoutSuccessClient() {
    const searchParams = useSearchParams()
    const orderId = searchParams.get("orderId")

    const [status, setStatus] = useState<OrderStatus | null>(null)
    const [eventTitle, setEventTitle] = useState<string | null>(null)
    const [error, setError] = useState("")

    useEffect(() => {
        if (!orderId) return

        let active = true
        let attempts = 0
        let timeoutId: ReturnType<typeof setTimeout> | null = null

        const pollOrder = async () => {
            try {
                const response = await fetch(`/api/orders/${orderId}`, { cache: "no-store" })
                const data = await response.json()

                if (!response.ok) {
                    throw new Error(data.error || "Error al consultar la orden")
                }

                if (!active) return

                setStatus(data.data.status)
                setEventTitle(data.data.eventTitle)

                if (data.data.status === "PENDING" && attempts < 10) {
                    attempts += 1
                    timeoutId = setTimeout(pollOrder, 3000)
                }
            } catch (err) {
                if (!active) return
                setError((err as Error).message)
            }
        }

        pollOrder()

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

    const isProcessing = status === null || status === "PENDING"
    const isPaid = status === "PAID"

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
            <Card className="w-full max-w-md shadow-xl border-0">
                <CardContent className="pt-10 pb-8 text-center">
                    {isProcessing ? (
                        <>
                            <Loader2 className="h-16 w-16 mx-auto text-[hsl(210,100%,40%)] animate-spin mb-4" />
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">
                                Procesando tu pago...
                            </h2>
                            <p className="text-gray-600">
                                Estamos confirmando tu transacción
                            </p>
                        </>
                    ) : isPaid ? (
                        <>
                            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 text-green-600 mb-6">
                                <CheckCircle className="h-10 w-10" />
                            </div>

                            <h1 className="text-3xl font-bold text-gray-900 mb-2">
                                ¡Pago Exitoso!
                            </h1>

                            <p className="text-gray-600 mb-8">
                                Tu orden <strong>#{orderId.slice(-8).toUpperCase()}</strong> ha sido confirmada.
                                {eventTitle ? ` Evento: ${eventTitle}.` : ""}
                                {" "}Hemos enviado los tickets a tu correo electrónico.
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
                    ) : (
                        <>
                            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-100 text-red-600 mb-6">
                                <XCircle className="h-10 w-10" />
                            </div>
                            <h1 className="text-3xl font-bold text-gray-900 mb-2">
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
