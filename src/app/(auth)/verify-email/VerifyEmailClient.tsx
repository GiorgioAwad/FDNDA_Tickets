"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { CheckCircle, XCircle, Loader2 } from "lucide-react"

export default function VerifyEmailClient() {
    const searchParams = useSearchParams()
    const token = searchParams.get("token")

    const [status, setStatus] = useState<"loading" | "success" | "error">(
        () => (token ? "loading" : "error")
    )
    const [message, setMessage] = useState(() =>
        token ? "" : "Token de verificaci\u00f3n no proporcionado"
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
                } else {
                    setStatus("error")
                    setMessage(data.error || "Error al verificar email")
                }
            } catch {
                setStatus("error")
                setMessage("Error de conexi\u00f3n")
            }
        }

        verifyEmail()
    }, [token])

    return (
        <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-gradient-to-b from-gray-50 to-white">
            <Card className="w-full max-w-md shadow-xl border-0">
                <CardContent className="pt-10 pb-8 text-center">
                    {status === "loading" && (
                        <>
                            <Loader2 className="h-16 w-16 mx-auto text-[hsl(210,100%,40%)] animate-spin mb-4" />
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">
                                Verificando tu email...
                            </h2>
                            <p className="text-gray-600">
                                Por favor espera un momento
                            </p>
                        </>
                    )}

                    {status === "success" && (
                        <>
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-4">
                                <CheckCircle className="h-8 w-8" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">{"\u00a1Email Verificado!"}</h2>
                            <p className="text-gray-600 mb-6">{message}</p>
                            <Link href="/login">
                                <Button className="w-full">{"Iniciar Sesi\u00f3n"}</Button>
                            </Link>
                        </>
                    )}

                    {status === "error" && (
                        <>
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-600 mb-4">
                                <XCircle className="h-8 w-8" />
                            </div>
                            <h2 className="text-2xl font-bold text-gray-900 mb-2">{"Error de Verificaci\u00f3n"}</h2>
                            <p className="text-gray-600 mb-6">{message}</p>
                            <div className="space-y-3">
                                <Link href="/register">
                                    <Button variant="outline" className="w-full">
                                        Registrarse de nuevo
                                    </Button>
                                </Link>
                                <Link href="/login">
                                    <Button variant="ghost" className="w-full">{"Ir a Iniciar Sesi\u00f3n"}</Button>
                                </Link>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
