"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, CheckCircle, Mail } from "lucide-react"

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("")
    const [error, setError] = useState("")
    const [success, setSuccess] = useState("")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setSuccess("")
        setLoading(true)

        try {
            const response = await fetch("/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            })

            const data = await response.json()

            if (!response.ok) {
                setError(data.error || "No se pudo procesar la solicitud")
                return
            }

            setSuccess(data.message)
        } catch {
            setError("Error de conexión")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-gradient-to-b from-gray-50 to-white">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white shadow-sm ring-1 ring-black/5 mb-4">
                        <Image
                            src="/logo.png"
                            alt="FDNDA"
                            width={48}
                            height={48}
                            className="h-12 w-12 object-contain"
                            priority
                        />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Ticketing FDNDA</h1>
                </div>

                <Card className="shadow-xl border-0">
                    <CardHeader className="text-center pb-0">
                        <CardTitle className="text-2xl">Recuperar contraseña</CardTitle>
                        <CardDescription>
                            Ingresa tu email y te enviaremos un enlace para restablecerla.
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="pt-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    {error}
                                </div>
                            )}

                            {success && (
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 text-green-700 text-sm">
                                    <CheckCircle className="h-4 w-4 flex-shrink-0" />
                                    {success}
                                </div>
                            )}

                            <div className="space-y-2">
                                <label htmlFor="email" className="text-sm font-medium text-gray-700">
                                    Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="tu@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="pl-10"
                                        required
                                    />
                                </div>
                            </div>

                            <Button type="submit" className="w-full" size="lg" loading={loading}>
                                Enviar instrucciones
                            </Button>
                        </form>

                        <div className="mt-6 text-center text-sm text-gray-600">
                            <Link
                                href="/login"
                                className="font-semibold text-[hsl(210,100%,40%)] hover:underline"
                            >
                                Volver a iniciar sesión
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
