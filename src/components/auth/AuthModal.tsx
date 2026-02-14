"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Mail, Lock, User, AlertCircle, CheckCircle, X } from "lucide-react"

interface AuthModalProps {
    open: boolean
    onClose: () => void
    onSuccess: () => void
}

export default function AuthModal({ open, onClose, onSuccess }: AuthModalProps) {
    const [mode, setMode] = useState<"login" | "register" | "verify">("login")

    // Login state
    const [loginEmail, setLoginEmail] = useState("")
    const [loginPassword, setLoginPassword] = useState("")
    const [loginError, setLoginError] = useState("")
    const [loginLoading, setLoginLoading] = useState(false)

    // Register state
    const [registerData, setRegisterData] = useState({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
    })
    const [registerError, setRegisterError] = useState("")
    const [registerLoading, setRegisterLoading] = useState(false)

    if (!open) return null

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoginError("")
        setLoginLoading(true)

        try {
            const result = await signIn("credentials", {
                email: loginEmail,
                password: loginPassword,
                redirect: false,
            })

            if (result?.error) {
                setLoginError("Email o contraseña incorrectos")
            } else {
                onSuccess()
            }
        } catch {
            setLoginError("Error al iniciar sesión")
        } finally {
            setLoginLoading(false)
        }
    }

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault()
        setRegisterError("")

        if (registerData.password !== registerData.confirmPassword) {
            setRegisterError("Las contraseñas no coinciden")
            return
        }

        if (registerData.password.length < 8) {
            setRegisterError("La contraseña debe tener al menos 8 caracteres")
            return
        }

        setRegisterLoading(true)

        try {
            const response = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(registerData),
            })

            const data = await response.json()

            if (!response.ok) {
                setRegisterError(data.error || "Error al registrar")
            } else {
                setMode("verify")
            }
        } catch {
            setRegisterError("Error de conexión")
        } finally {
            setRegisterLoading(false)
        }
    }

    const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRegisterData({ ...registerData, [e.target.name]: e.target.value })
    }

    const switchToLogin = () => {
        setMode("login")
        setLoginEmail(registerData.email)
        setLoginPassword("")
        setLoginError("")
    }

    const switchToRegister = () => {
        setMode("register")
        setRegisterError("")
    }

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} />
            <div className="relative z-10 w-full max-w-md">
                <Card className="shadow-2xl border-0">
                    <button
                        onClick={onClose}
                        className="absolute right-4 top-4 p-1 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    {mode === "login" && (
                        <>
                            <CardHeader className="text-center pb-0">
                                <CardTitle className="text-xl">Iniciar Sesión</CardTitle>
                                <CardDescription>
                                    Inicia sesión para completar tu compra
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <form onSubmit={handleLogin} className="space-y-4">
                                    {loginError && (
                                        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
                                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                            {loginError}
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <label htmlFor="modal-login-email" className="text-sm font-medium text-gray-700">
                                            Email
                                        </label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                            <Input
                                                id="modal-login-email"
                                                type="email"
                                                placeholder="tu@email.com"
                                                value={loginEmail}
                                                onChange={(e) => setLoginEmail(e.target.value)}
                                                className="pl-10"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="modal-login-password" className="text-sm font-medium text-gray-700">
                                            Contraseña
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                            <Input
                                                id="modal-login-password"
                                                type="password"
                                                placeholder="********"
                                                value={loginPassword}
                                                onChange={(e) => setLoginPassword(e.target.value)}
                                                className="pl-10"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <Button type="submit" className="w-full" size="lg" loading={loginLoading}>
                                        Iniciar Sesión
                                    </Button>
                                </form>

                                <div className="mt-6 text-center text-sm text-gray-600">
                                    ¿No tienes cuenta?{" "}
                                    <button
                                        type="button"
                                        onClick={switchToRegister}
                                        className="font-semibold text-[hsl(210,100%,40%)] hover:underline"
                                    >
                                        Regístrate gratis
                                    </button>
                                </div>
                            </CardContent>
                        </>
                    )}

                    {mode === "register" && (
                        <>
                            <CardHeader className="text-center pb-0">
                                <CardTitle className="text-xl">Crear Cuenta</CardTitle>
                                <CardDescription>
                                    Regístrate para completar tu compra
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="pt-6">
                                <form onSubmit={handleRegister} className="space-y-4">
                                    {registerError && (
                                        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
                                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                            {registerError}
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <label htmlFor="modal-reg-name" className="text-sm font-medium text-gray-700">
                                            Nombre Completo
                                        </label>
                                        <div className="relative">
                                            <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                            <Input
                                                id="modal-reg-name"
                                                name="name"
                                                type="text"
                                                placeholder="Juan Pérez"
                                                value={registerData.name}
                                                onChange={handleRegisterChange}
                                                className="pl-10"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="modal-reg-email" className="text-sm font-medium text-gray-700">
                                            Email
                                        </label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                            <Input
                                                id="modal-reg-email"
                                                name="email"
                                                type="email"
                                                placeholder="tu@email.com"
                                                value={registerData.email}
                                                onChange={handleRegisterChange}
                                                className="pl-10"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="modal-reg-password" className="text-sm font-medium text-gray-700">
                                            Contraseña
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                            <Input
                                                id="modal-reg-password"
                                                name="password"
                                                type="password"
                                                placeholder="Mínimo 8 caracteres"
                                                value={registerData.password}
                                                onChange={handleRegisterChange}
                                                className="pl-10"
                                                required
                                                minLength={8}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="modal-reg-confirm" className="text-sm font-medium text-gray-700">
                                            Confirmar contraseña
                                        </label>
                                        <div className="relative">
                                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                            <Input
                                                id="modal-reg-confirm"
                                                name="confirmPassword"
                                                type="password"
                                                placeholder="Repite tu contraseña"
                                                value={registerData.confirmPassword}
                                                onChange={handleRegisterChange}
                                                className="pl-10"
                                                required
                                            />
                                        </div>
                                    </div>

                                    <Button type="submit" className="w-full" size="lg" loading={registerLoading}>
                                        Crear Cuenta
                                    </Button>
                                </form>

                                <div className="mt-6 text-center text-sm text-gray-600">
                                    ¿Ya tienes cuenta?{" "}
                                    <button
                                        type="button"
                                        onClick={switchToLogin}
                                        className="font-semibold text-[hsl(210,100%,40%)] hover:underline"
                                    >
                                        Inicia Sesión
                                    </button>
                                </div>
                            </CardContent>
                        </>
                    )}

                    {mode === "verify" && (
                        <CardContent className="pt-10 pb-8 text-center">
                            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 text-green-600 mb-4">
                                <CheckCircle className="h-8 w-8" />
                            </div>
                            <h2 className="text-xl font-bold text-gray-900 mb-2">
                                ¡Registro Exitoso!
                            </h2>
                            <p className="text-gray-600 mb-6">
                                Te hemos enviado un correo de verificación a <strong>{registerData.email}</strong>.
                                Revisa tu bandeja de entrada y haz clic en el enlace para activar tu cuenta.
                            </p>
                            <Button onClick={switchToLogin} className="w-full">
                                Ya verifiqué, Iniciar Sesión
                            </Button>
                            <p className="text-sm text-gray-500 mt-3">
                                ¿No recibiste el correo? Revisa tu carpeta de spam.
                            </p>
                        </CardContent>
                    )}
                </Card>
            </div>
        </div>
    )
}
