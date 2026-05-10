"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/AuthShell"
import { Mail, Lock, AlertCircle, Eye, EyeOff } from "lucide-react"

export default function LoginClient() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const callbackUrl = searchParams.get("callbackUrl")

    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        try {
            const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
            })

            if (result?.error) {
                setError("Email o contraseña incorrectos")
                toast.error("No pudimos iniciar sesión", { description: "Revisa tu email y contraseña." })
            } else {
                toast.success("¡Bienvenido de vuelta!")
                const destination = callbackUrl || "/"
                router.push(destination)
                router.refresh()
            }
        } catch {
            setError("Error al iniciar sesión")
            toast.error("Algo salió mal. Intenta nuevamente.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthShell
            title="Bienvenido de vuelta"
            subtitle="Ingresa tus datos para continuar"
            footer={
                <>
                    ¿No tienes cuenta?{" "}
                    <Link href="/register" className="font-semibold text-fdnda-secondary hover:text-coral transition-colors">
                        Regístrate gratis
                    </Link>
                </>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-coral-soft text-coral-strong text-sm border border-coral/20">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                <div className="space-y-1.5">
                    <label htmlFor="email" className="text-sm font-semibold text-foreground">
                        Email
                    </label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            id="email"
                            type="email"
                            placeholder="tu@email.com"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="pl-10 h-11"
                            autoComplete="email"
                            required
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label htmlFor="password" className="text-sm font-semibold text-foreground">
                            Contraseña
                        </label>
                        <Link
                            href="/forgot-password"
                            className="text-xs text-fdnda-secondary hover:text-coral transition-colors font-medium"
                        >
                            ¿Olvidaste tu contraseña?
                        </Link>
                    </div>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="pl-10 pr-10 h-11"
                            autoComplete="current-password"
                            required
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                        >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                    </div>
                </div>

                <Button type="submit" variant="coral" className="w-full rounded-xl h-12" loading={loading}>
                    Iniciar sesión
                </Button>
            </form>
        </AuthShell>
    )
}
