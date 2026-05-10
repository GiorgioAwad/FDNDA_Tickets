"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { motion } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle, XCircle, Loader2 } from "lucide-react"

export default function VerifyEmailClient() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const token = searchParams.get("token")

    const [status, setStatus] = useState<"loading" | "success" | "error">(
        () => (token ? "loading" : "error")
    )
    const [message, setMessage] = useState(() =>
        token ? "" : "Token de verificación no proporcionado"
    )

    useEffect(() => {
        if (!token) return

        const verifyEmail = async () => {
            try {
                setStatus("loading")
                setMessage("")
                const response = await fetch(`/api/auth/verify?token=${token}`)
                const data = await response.json()

                if (response.ok) {
                    setStatus("success")
                    setMessage(data.message || "Email verificado correctamente")
                    router.replace("/?verified=1")
                } else {
                    setStatus("error")
                    setMessage(data.error || "Error al verificar email")
                }
            } catch {
                setStatus("error")
                setMessage("Error de conexión")
            }
        }

        verifyEmail()
    }, [router, token])

    return (
        <div className="relative min-h-screen flex items-center justify-center py-10 sm:py-14 px-4 overflow-hidden bg-gradient-to-br from-fdnda-light/40 via-white to-fdnda-light/20">
            <div className="pointer-events-none absolute -top-20 -left-20 h-80 w-80 rounded-full bg-fdnda-accent/15 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-20 h-80 w-80 rounded-full bg-coral/15 blur-3xl" />

            <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }}
                className="relative w-full max-w-md"
            >
                <Card className="border-0 shadow-elevated overflow-hidden">
                    <div className="h-1.5 bg-gradient-to-r from-fdnda-primary via-fdnda-accent to-coral" />
                    <CardContent className="pt-10 pb-10 text-center px-6 sm:px-8">
                        {status === "loading" && (
                            <>
                                <div className="relative inline-flex items-center justify-center mb-6">
                                    <div className="absolute inset-0 rounded-full bg-fdnda-secondary/20 blur-xl animate-pulse" />
                                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white shadow-glow-primary">
                                        <Loader2 className="h-10 w-10 animate-spin" />
                                    </div>
                                </div>
                                <h2 className="font-display text-2xl sm:text-3xl font-bold mb-2">
                                    Verificando tu email…
                                </h2>
                                <p className="text-muted-foreground">Por favor espera un momento.</p>
                            </>
                        )}

                        {status === "success" && (
                            <>
                                <motion.div
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                                    className="relative inline-flex items-center justify-center mb-6"
                                >
                                    <div className="absolute inset-0 rounded-full bg-success/20 blur-2xl" />
                                    <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-success to-green-600 text-white shadow-2xl">
                                        <CheckCircle className="h-12 w-12" />
                                    </div>
                                </motion.div>
                                <h1 className="font-display text-2xl sm:text-3xl font-bold mb-2">
                                    ¡Email verificado!
                                </h1>
                                <p className="text-muted-foreground mb-6">{message}</p>
                                <Link href="/login">
                                    <Button variant="coral" className="w-full rounded-full" size="lg">
                                        Iniciar sesión
                                    </Button>
                                </Link>
                            </>
                        )}

                        {status === "error" && (
                            <>
                                <div className="relative inline-flex items-center justify-center mb-6">
                                    <div className="absolute inset-0 rounded-full bg-coral/20 blur-xl" />
                                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-coral to-coral-strong text-white shadow-glow-coral">
                                        <XCircle className="h-10 w-10" />
                                    </div>
                                </div>
                                <h2 className="font-display text-2xl sm:text-3xl font-bold mb-2">
                                    Error de verificación
                                </h2>
                                <p className="text-muted-foreground mb-6">{message}</p>
                                <div className="space-y-3">
                                    <Link href="/register">
                                        <Button variant="coral" className="w-full rounded-full" size="lg">
                                            Registrarse de nuevo
                                        </Button>
                                    </Link>
                                    <Link href="/login">
                                        <Button variant="ghost" className="w-full">
                                            Ir a iniciar sesión
                                        </Button>
                                    </Link>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    )
}
