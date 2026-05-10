"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/AuthShell"
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
                toast.error(data.error || "No se pudo procesar la solicitud")
                return
            }

            setSuccess(data.message)
            toast.success("Revisa tu correo")
        } catch {
            setError("Error de conexión")
            toast.error("Sin conexión. Intenta nuevamente.")
        } finally {
            setLoading(false)
        }
    }

    return (
        <AuthShell
            title="¿Olvidaste tu contraseña?"
            subtitle="Te enviaremos un enlace para restablecerla"
            footer={
                <Link href="/login" className="font-semibold text-fdnda-secondary hover:text-coral transition-colors">
                    ← Volver a iniciar sesión
                </Link>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-coral-soft text-coral-strong text-sm border border-coral/20">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                {success && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-success/10 text-success text-sm border border-success/20">
                        <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        {success}
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
                            required
                            autoComplete="email"
                        />
                    </div>
                </div>

                <Button type="submit" variant="coral" className="w-full rounded-xl h-12" loading={loading}>
                    Enviar instrucciones
                </Button>
            </form>
        </AuthShell>
    )
}
