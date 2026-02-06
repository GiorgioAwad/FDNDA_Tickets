"use client"

import { useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Mail, Lock, User, AlertCircle, CheckCircle } from "lucide-react"

export default function RegisterPage() {
    const [formData, setFormData] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
    })
    const [error, setError] = useState("")
    const [success, setSuccess] = useState(false)
    const [loading, setLoading] = useState(false)

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value })
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        // Validate passwords match
        if (formData.password !== formData.confirmPassword) {
            setError("Las contraseñas no coinciden")
            setLoading(false)
            return
        }

        // Validate password strength
        if (formData.password.length < 8) {
            setError("La contraseña debe tener al menos 8 caracteres")
            setLoading(false)
            return
        }

        try {
            const response = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(formData),
            })

            const data = await response.json()

            if (!response.ok) {
                setError(data.error || "Error al registrar")
            } else {
                setSuccess(true)
            }
        } catch {
            setError("Error de conexión")
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-gradient-to-b from-gray-50 to-white">
                <Card className="w-full max-w-md shadow-xl border-0">
                    <CardContent className="pt-10 pb-8 text-center">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-4">
                            <CheckCircle className="h-8 w-8" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">
                            ¡Registro Exitoso!
                        </h2>
                        <p className="text-gray-600 mb-6">
                            Te hemos enviado un correo de verificación a <strong>{formData.email}</strong>.
                            Por favor revisa tu bandeja de entrada y haz clic en el enlace para activar tu cuenta.
                        </p>
                        <div className="space-y-3">
                            <Link href="/login">
                                <Button className="w-full">Ir a Iniciar Sesión</Button>
                            </Link>
                            <p className="text-sm text-gray-500">
                                ¿No recibiste el correo? Revisa tu carpeta de spam.
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-gradient-to-b from-gray-50 to-white">
            <div className="w-full max-w-md">
                {/* Logo */}
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
                        <CardTitle className="text-2xl">Crear Cuenta</CardTitle>
                        <CardDescription>
                            Regístrate para comprar entradas a eventos
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

                            <div className="space-y-2">
                                <label htmlFor="name" className="text-sm font-medium text-gray-700">
                                    Nombre Completo
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="name"
                                        name="name"
                                        type="text"
                                        placeholder="Juan Pérez"
                                        value={formData.name}
                                        onChange={handleChange}
                                        className="pl-10"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="email" className="text-sm font-medium text-gray-700">
                                    Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="email"
                                        name="email"
                                        type="email"
                                        placeholder="tu@email.com"
                                        value={formData.email}
                                        onChange={handleChange}
                                        className="pl-10"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="password" className="text-sm font-medium text-gray-700">{"Contrase\u00f1a"}</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="password"
                                        name="password"
                                        type="password"
                                        placeholder="Mínimo 8 caracteres"
                                        value={formData.password}
                                        onChange={handleChange}
                                        className="pl-10"
                                        required
                                        minLength={8}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">{"Confirmar contrase\u00f1a"}</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        type="password"
                                        placeholder="Repite tu contraseña"
                                        value={formData.confirmPassword}
                                        onChange={handleChange}
                                        className="pl-10"
                                        required
                                    />
                                </div>
                            </div>

                            <Button type="submit" className="w-full" size="lg" loading={loading}>
                                Crear Cuenta
                            </Button>

                            <p className="text-xs text-gray-500 text-center">
                                Al registrarte, aceptas nuestros{" "}
                                <Link href="#" className="text-[hsl(210,100%,40%)] hover:underline">
                                    Términos y Condiciones
                                </Link>{" "}
                                y{" "}
                                <Link href="#" className="text-[hsl(210,100%,40%)] hover:underline">
                                    Política de Privacidad
                                </Link>
                            </p>
                        </form>

                        <div className="mt-6 text-center text-sm text-gray-600">
                            ¿Ya tienes cuenta?{" "}
                            <Link
                                href="/login"
                                className="font-semibold text-[hsl(210,100%,40%)] hover:underline"
                            >
                                Inicia Sesión
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
