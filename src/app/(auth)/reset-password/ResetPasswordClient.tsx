"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/AuthShell"
import { AlertCircle, CheckCircle, Lock } from "lucide-react"

export default function ResetPasswordClient() {
    const searchParams = useSearchParams()
    const token = searchParams.get("token") || ""

    const [password, setPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [error, setError] = useState("")
    const [success, setSuccess] = useState("")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setSuccess("")

        if (!token) {
            setError("El enlace no es válido o ya expiró.")
            return
        }

        setLoading(true)

        try {
            const response = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, password, confirmPassword }),
            })

            const data = await response.json()

            if (!response.ok) {
                setError(data.error || "No se pudo actualizar la contraseña")
                toast.error(data.error || "No se pudo actualizar")
                return
            }

            setSuccess(data.message)
            setPassword("")
            setConfirmPassword("")
            toast.success("Contraseña actualizada")
        } catch {
            setError("Error de conexión")
            toast.error("Sin conexión")
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthShell
            title="Nueva contraseña"
            subtitle="Crea una nueva clave para acceder a tu cuenta"
            footer={
                success ? (
                    <Link href="/login" className="font-semibold text-fdnda-secondary hover:text-coral transition-colors">
                        Ir a iniciar sesión →
                    </Link>
                ) : null
            }
        >
            {!token ? (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-coral-soft text-coral-strong text-sm border border-coral/20">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        El enlace no es válido o ya expiró.
                    </div>
                    <Link href="/forgot-password">
                        <Button variant="coral" className="w-full rounded-xl">Solicitar otro enlace</Button>
                    </Link>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                    {error && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-coral-soft text-coral-strong text-sm border border-coral/20">
                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-success/10 text-success text-sm border border-success/20">
                            <CheckCircle className="h-4 w-4 flex-shrink-0" />
                            {success}
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <label htmlFor="password" className="text-sm font-semibold text-foreground">
                            Contraseña nueva
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="password"
                                type="password"
                                placeholder="Mínimo 8 caracteres"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="pl-10 h-11"
                                minLength={8}
                                required
                                autoComplete="new-password"
                            />
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <label htmlFor="confirmPassword" className="text-sm font-semibold text-foreground">
                            Confirmar contraseña
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                id="confirmPassword"
                                type="password"
                                placeholder="Repite tu contraseña"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="pl-10 h-11"
                                required
                                autoComplete="new-password"
                            />
                        </div>
                    </div>

                    <Button type="submit" variant="coral" className="w-full rounded-xl h-12" loading={loading}>
                        Actualizar contraseña
                    </Button>
                </form>
            )}
        </AuthShell>
    )
}
