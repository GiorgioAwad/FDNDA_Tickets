"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useCart } from "@/hooks/cart-context"
import { Confetti } from "@/components/checkout/Confetti"
import { AlertCircle, CheckCircle, Loader2, Ticket, XCircle, ArrowRight, Calendar } from "lucide-react"

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
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-fdnda-light/30 via-white to-white">
                <Card className="w-full max-w-md mx-4">
                    <CardContent className="text-center py-12">
                        <AlertCircle className="h-12 w-12 mx-auto text-coral mb-4" />
                        <h2 className="font-display text-xl font-bold mb-2">Orden no encontrada</h2>
                        <p className="text-muted-foreground mb-6">No pudimos identificar tu orden de compra.</p>
                        <Link href="/eventos">
                            <Button>Ver eventos</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        )
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-fdnda-light/30 via-white to-white">
                <Card className="w-full max-w-md mx-4">
                    <CardContent className="text-center py-12">
                        <AlertCircle className="h-12 w-12 mx-auto text-coral mb-4" />
                        <h2 className="font-display text-xl font-bold mb-2">Algo salió mal</h2>
                        <p className="text-muted-foreground mb-6">{error}</p>
                        <Link href="/mi-cuenta/entradas">
                            <Button>Ver mis entradas</Button>
                        </Link>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const isPaid = status === "PAID"
    const isManualReview = status === "PENDING" && reviewRequired
    const isProcessing = status === null || (status === "PENDING" && !reviewRequired)

    return (
        <div className="relative min-h-screen flex items-center justify-center py-10 sm:py-16 px-4 overflow-hidden bg-gradient-to-br from-fdnda-light/40 via-white to-fdnda-light/20">
            <div className="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-fdnda-accent/15 blur-3xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-coral/15 blur-3xl" aria-hidden="true" />

            {isPaid && <Confetti />}

            <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }}
                className="relative w-full max-w-lg"
            >
                <Card className="border-0 shadow-elevated overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-fdnda-primary via-fdnda-accent to-coral" />
                    <CardContent className="pt-10 pb-10 text-center px-6 sm:px-8">
                        {isProcessing ? (
                            <>
                                <div className="relative inline-flex items-center justify-center mb-6">
                                    <div className="absolute inset-0 rounded-full bg-fdnda-secondary/20 blur-xl animate-pulse" />
                                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white shadow-glow-primary">
                                        <Loader2 className="h-10 w-10 animate-spin" />
                                    </div>
                                </div>
                                <h2 className="font-display text-2xl sm:text-3xl font-bold mb-2">
                                    Procesando tu pago…
                                </h2>
                                <p className="text-muted-foreground">
                                    Estamos confirmando tu transacción. Esto solo tomará unos segundos.
                                </p>
                                {statusMessage && (
                                    <p className="text-sm text-muted-foreground mt-4 italic">{statusMessage}</p>
                                )}
                            </>
                        ) : isPaid ? (
                            <>
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                                    className="relative inline-flex items-center justify-center mb-6"
                                >
                                    <div className="absolute inset-0 rounded-full bg-success/20 blur-2xl" />
                                    <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-success to-green-600 text-white shadow-2xl">
                                        <CheckCircle className="h-12 w-12" />
                                    </div>
                                </motion.div>

                                <p className="text-xs font-bold uppercase tracking-widest text-success mb-2">
                                    ¡Pago confirmado!
                                </p>
                                <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3">
                                    ¡Listo, nos vemos allá! 🎉
                                </h1>

                                <p className="text-muted-foreground mb-2">
                                    Orden <span className="font-mono font-semibold text-foreground">#{orderId.slice(-8).toUpperCase()}</span> confirmada.
                                </p>
                                {eventTitle && (
                                    <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-fdnda-primary bg-fdnda-light/50 rounded-full px-3 py-1 mb-6">
                                        <Calendar className="h-3.5 w-3.5" />
                                        {eventTitle}
                                    </p>
                                )}
                                <p className="text-sm text-muted-foreground mb-8">
                                    Hemos enviado tus tickets a tu correo electrónico. También están disponibles en tu cuenta.
                                </p>

                                <div className="space-y-3">
                                    <Link href="/mi-cuenta/entradas">
                                        <Button variant="coral" className="w-full rounded-full" size="lg">
                                            <Ticket className="h-4 w-4" />
                                            Ver mis entradas
                                            <ArrowRight className="h-4 w-4" />
                                        </Button>
                                    </Link>
                                    <Link href="/eventos">
                                        <Button variant="outline" className="w-full rounded-full">
                                            Explorar más eventos
                                        </Button>
                                    </Link>
                                </div>
                            </>
                        ) : isManualReview ? (
                            <>
                                <div className="relative inline-flex items-center justify-center mb-6">
                                    <div className="absolute inset-0 rounded-full bg-warning/20 blur-xl" />
                                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-warning text-white shadow-lg">
                                        <AlertCircle className="h-10 w-10" />
                                    </div>
                                </div>
                                <h1 className="font-display text-2xl sm:text-3xl font-bold mb-3">
                                    Pago en validación
                                </h1>
                                <p className="text-muted-foreground mb-2">
                                    Orden <span className="font-mono font-semibold text-foreground">#{orderId.slice(-8).toUpperCase()}</span>.
                                </p>
                                {eventTitle && <p className="text-sm font-semibold mb-4">{eventTitle}</p>}
                                <p className="text-sm text-muted-foreground mb-6">
                                    Tu pago está en revisión manual. <strong>No vuelvas a pagar</strong>: te confirmaremos por correo en breve.
                                </p>
                                {statusMessage && (
                                    <p className="text-xs text-muted-foreground italic mb-6">{statusMessage}</p>
                                )}
                                <Link href="/eventos">
                                    <Button variant="outline" className="w-full rounded-full">
                                        Volver a eventos
                                    </Button>
                                </Link>
                            </>
                        ) : (
                            <>
                                <div className="relative inline-flex items-center justify-center mb-6">
                                    <div className="absolute inset-0 rounded-full bg-coral/20 blur-xl" />
                                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-coral to-coral-strong text-white shadow-glow-coral">
                                        <XCircle className="h-10 w-10" />
                                    </div>
                                </div>
                                <h1 className="font-display text-2xl sm:text-3xl font-bold mb-3">
                                    Pago no completado
                                </h1>
                                <p className="text-muted-foreground mb-6">
                                    La orden <span className="font-mono font-semibold text-foreground">#{orderId.slice(-8).toUpperCase()}</span> no pudo confirmarse. Intenta nuevamente o contacta soporte.
                                </p>
                                <div className="space-y-3">
                                    <Link href="/eventos">
                                        <Button variant="coral" className="w-full rounded-full" size="lg">
                                            Intentar nuevamente
                                        </Button>
                                    </Link>
                                    <a href="https://wa.me/51941632535" target="_blank" rel="noopener noreferrer">
                                        <Button variant="ghost" className="w-full">
                                            Contactar soporte
                                        </Button>
                                    </a>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    )
}
