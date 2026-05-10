"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AuthShell } from "@/components/auth/AuthShell"
import { Mail, Lock, User, AlertCircle, CheckCircle, Phone, CreditCard, Calendar, MapPin, Eye, EyeOff } from "lucide-react"
import { DISTRITOS_LIMA } from "@/lib/distritos-lima"
import { cn } from "@/lib/utils"

function calculatePasswordStrength(pw: string): { score: number; label: string; color: string } {
    let score = 0
    if (pw.length >= 8) score++
    if (pw.length >= 12) score++
    if (/[A-Z]/.test(pw)) score++
    if (/[0-9]/.test(pw)) score++
    if (/[^A-Za-z0-9]/.test(pw)) score++
    if (score <= 1) return { score, label: "Débil", color: "bg-coral" }
    if (score <= 3) return { score, label: "Aceptable", color: "bg-warning" }
    return { score, label: "Fuerte", color: "bg-success" }
}

export default function RegisterPage() {
    const [formData, setFormData] = useState({
        name: "",
        dni: "",
        phone: "",
        birthDate: "",
        distrito: "",
        email: "",
        password: "",
        confirmPassword: "",
    })
    const [error, setError] = useState("")
    const [success, setSuccess] = useState(false)
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)

    const pwStrength = useMemo(() => calculatePasswordStrength(formData.password), [formData.password])

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value })
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        if (!/^\d{8}$/.test(formData.dni)) {
            setError("El DNI debe tener exactamente 8 dígitos")
            setLoading(false)
            return
        }
        if (!/^\d{9}$/.test(formData.phone)) {
            setError("El teléfono debe tener exactamente 9 dígitos")
            setLoading(false)
            return
        }
        if (!formData.birthDate) {
            setError("La fecha de nacimiento es obligatoria")
            setLoading(false)
            return
        }
        if (!formData.distrito) {
            setError("El distrito es obligatorio")
            setLoading(false)
            return
        }
        if (formData.password !== formData.confirmPassword) {
            setError("Las contraseñas no coinciden")
            setLoading(false)
            return
        }
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
                toast.error("No pudimos crear tu cuenta", { description: data.error || "Revisa tus datos." })
            } else {
                setSuccess(true)
                toast.success("¡Cuenta creada!", { description: "Revisa tu correo para verificar." })
            }
        } catch {
            setError("Error de conexión")
            toast.error("Sin conexión. Intenta nuevamente.")
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <AuthShell title="¡Bienvenido a FDNDA!" subtitle="Verifica tu correo para empezar">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-success/10 text-success mb-4">
                        <CheckCircle className="h-8 w-8" />
                    </div>
                    <p className="text-muted-foreground mb-2">
                        Te enviamos un correo de verificación a:
                    </p>
                    <p className="font-semibold text-foreground mb-6">{formData.email}</p>
                    <p className="text-sm text-muted-foreground mb-6">
                        Haz clic en el enlace del correo para activar tu cuenta. Si no lo ves, revisa tu carpeta de spam.
                    </p>
                    <Link href="/login">
                        <Button variant="coral" className="w-full rounded-xl">Ir a iniciar sesión</Button>
                    </Link>
                </div>
            </AuthShell>
        )
    }

    return (
        <AuthShell
            title="Crea tu cuenta"
            subtitle="Acceso gratuito a todos los eventos oficiales"
            footer={
                <>
                    ¿Ya tienes cuenta?{" "}
                    <Link href="/login" className="font-semibold text-fdnda-secondary hover:text-coral transition-colors">
                        Iniciar sesión
                    </Link>
                </>
            }
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-coral-soft text-coral-strong text-sm border border-coral/20">
                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                        {error}
                    </div>
                )}

                <Field id="name" label="Nombre completo" icon={User}>
                    <Input id="name" name="name" type="text" placeholder="Juan Pérez" value={formData.name} onChange={handleChange} className="pl-10 h-11" required />
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field id="dni" label="DNI" icon={CreditCard}>
                        <Input id="dni" name="dni" type="text" inputMode="numeric" placeholder="12345678" value={formData.dni} onChange={handleChange} className="pl-10 h-11" maxLength={8} required />
                    </Field>
                    <Field id="phone" label="Teléfono" icon={Phone}>
                        <Input id="phone" name="phone" type="tel" inputMode="numeric" placeholder="987654321" value={formData.phone} onChange={handleChange} className="pl-10 h-11" maxLength={9} required />
                    </Field>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <Field id="birthDate" label="Nacimiento" icon={Calendar}>
                        <Input id="birthDate" name="birthDate" type="date" value={formData.birthDate} onChange={handleChange} className="pl-10 h-11" required />
                    </Field>
                    <Field id="distrito" label="Distrito" icon={MapPin}>
                        <select
                            id="distrito"
                            name="distrito"
                            value={formData.distrito}
                            onChange={handleChange}
                            className="flex h-11 w-full rounded-md border border-input bg-background pl-10 pr-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 appearance-none"
                            required
                        >
                            <option value="">Selecciona</option>
                            {DISTRITOS_LIMA.map((d) => (
                                <option key={d} value={d}>{d}</option>
                            ))}
                        </select>
                    </Field>
                </div>

                <Field id="email" label="Email" icon={Mail}>
                    <Input id="email" name="email" type="email" placeholder="tu@email.com" value={formData.email} onChange={handleChange} className="pl-10 h-11" required autoComplete="email" />
                </Field>

                <Field id="password" label="Contraseña" icon={Lock}>
                    <Input id="password" name="password" type={showPassword ? "text" : "password"} placeholder="Mínimo 8 caracteres" value={formData.password} onChange={handleChange} className="pl-10 pr-10 h-11" required minLength={8} autoComplete="new-password" />
                    <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        aria-label={showPassword ? "Ocultar" : "Mostrar"}
                    >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </Field>

                {formData.password && (
                    <div className="space-y-1">
                        <div className="flex gap-1">
                            {[0, 1, 2, 3, 4].map((i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "h-1 flex-1 rounded-full transition-colors",
                                        i < pwStrength.score ? pwStrength.color : "bg-muted"
                                    )}
                                />
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Seguridad: <span className="font-semibold text-foreground">{pwStrength.label}</span>
                        </p>
                    </div>
                )}

                <Field id="confirmPassword" label="Confirmar contraseña" icon={Lock}>
                    <Input id="confirmPassword" name="confirmPassword" type="password" placeholder="Repite tu contraseña" value={formData.confirmPassword} onChange={handleChange} className="pl-10 h-11" required autoComplete="new-password" />
                </Field>

                <Button type="submit" variant="coral" className="w-full rounded-xl h-12" loading={loading}>
                    Crear cuenta
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                    Al registrarte, aceptas los{" "}
                    <Link href="/terminos" className="text-fdnda-secondary hover:underline">términos</Link>
                    {" "}y la{" "}
                    <Link href="/privacidad" className="text-fdnda-secondary hover:underline">política de privacidad</Link>.
                </p>
            </form>
        </AuthShell>
    )
}

function Field({
    id,
    label,
    icon: Icon,
    children,
}: {
    id: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    children: React.ReactNode
}) {
    return (
        <div className="space-y-1.5">
            <label htmlFor={id} className="text-sm font-semibold text-foreground">
                {label}
            </label>
            <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10 pointer-events-none" />
                {children}
            </div>
        </div>
    )
}
