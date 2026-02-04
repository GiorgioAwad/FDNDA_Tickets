"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Gift, CheckCircle, AlertCircle, Calendar, MapPin, Ticket, User } from "lucide-react"
import Link from "next/link"

type EventInfo = {
    id: string
    title: string
    startDate: string
    venue: string
}

type CodeData = {
    event: EventInfo
    ticketType: string
    hasAssignedAttendee: boolean
    assignedName: string | null
    assignedDniMasked: string | null
}

export default function CanjearPage() {
    const { data: session, status } = useSession()
    const router = useRouter()
    
    const [code, setCode] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [codeData, setCodeData] = useState<CodeData | null>(null)
    const [success, setSuccess] = useState(false)
    
    // Form para datos de asistente (solo si no hay pre-asignados)
    const [attendeeName, setAttendeeName] = useState("")
    const [attendeeDni, setAttendeeDni] = useState("")

    const handleVerifyCode = async () => {
        if (!code.trim()) return
        
        setLoading(true)
        setError("")
        setCodeData(null)
        
        try {
            const res = await fetch(`/api/courtesy/claim?code=${encodeURIComponent(code)}`)
            const data = await res.json()
            
            if (data.valid) {
                setCodeData(data.data)
            } else {
                setError(data.error || "Código no válido")
            }
        } catch {
            setError("Error al verificar código")
        } finally {
            setLoading(false)
        }
    }

    const handleClaim = async () => {
        if (status !== "authenticated") {
            // Redirigir a login con callback
            router.push(`/login?callbackUrl=/canjear?code=${encodeURIComponent(code)}`)
            return
        }

        if (!codeData?.hasAssignedAttendee && (!attendeeName || !attendeeDni)) {
            setError("Por favor completa tus datos")
            return
        }

        setLoading(true)
        setError("")

        try {
            const res = await fetch("/api/courtesy/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code,
                    attendeeName: codeData?.hasAssignedAttendee ? undefined : attendeeName,
                    attendeeDni: codeData?.hasAssignedAttendee ? undefined : attendeeDni,
                }),
            })

            const data = await res.json()

            if (data.success) {
                setSuccess(true)
            } else {
                setError(data.error || "Error al canjear")
            }
        } catch {
            setError("Error al canjear cortesía")
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 flex items-center justify-center p-4">
                <Card className="max-w-md w-full text-center">
                    <CardContent className="pt-8 pb-6">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle className="h-8 w-8 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">¡Entrada Canjeada!</h2>
                        <p className="text-gray-600 mb-6">
                            Tu entrada ha sido agregada a tu cuenta. Revisa tu email para ver el código QR.
                        </p>
                        <div className="space-y-3">
                            <Button asChild className="w-full">
                                <Link href="/mi-cuenta/entradas">
                                    <Ticket className="h-4 w-4 mr-2" />
                                    Ver Mis Entradas
                                </Link>
                            </Button>
                            <Button variant="outline" asChild className="w-full">
                                <Link href="/eventos">
                                    Ver Más Eventos
                                </Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50 py-12 px-4">
            <div className="max-w-lg mx-auto">
                {/* Header */}
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Gift className="h-8 w-8 text-purple-600" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">Canjear Cortesía</h1>
                    <p className="text-gray-600 mt-2">
                        Ingresa el código que recibiste para obtener tu entrada
                    </p>
                </div>

                {/* Code Input Card */}
                <Card className="mb-6">
                    <CardContent className="pt-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Código de Cortesía</label>
                                <div className="flex gap-2">
                                    <Input
                                        value={code}
                                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                                        placeholder="Ej: A1B2C3D4"
                                        className="uppercase font-mono text-lg tracking-wider"
                                        onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
                                    />
                                    <Button 
                                        onClick={handleVerifyCode} 
                                        disabled={loading || !code.trim()}
                                    >
                                        {loading ? "..." : "Verificar"}
                                    </Button>
                                </div>
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Event Details Card */}
                {codeData && (
                    <Card className="mb-6">
                        <CardHeader>
                            <CardTitle className="text-lg">Detalles de tu Cortesía</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                                <h3 className="font-bold text-lg">{codeData.event.title}</h3>
                                <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <Calendar className="h-4 w-4" />
                                    <span>
                                        {new Date(codeData.event.startDate).toLocaleDateString("es-PE", {
                                            weekday: "long",
                                            day: "numeric",
                                            month: "long",
                                            year: "numeric",
                                        })}
                                    </span>
                                </div>
                                {codeData.event.venue && (
                                    <div className="flex items-center gap-2 text-sm text-gray-600">
                                        <MapPin className="h-4 w-4" />
                                        <span>{codeData.event.venue}</span>
                                    </div>
                                )}
                                <div className="flex items-center gap-2 text-sm">
                                    <Ticket className="h-4 w-4 text-purple-600" />
                                    <span className="font-medium">{codeData.ticketType}</span>
                                </div>
                            </div>

                            {/* Attendee Info */}
                            {codeData.hasAssignedAttendee ? (
                                <div className="bg-purple-50 p-4 rounded-lg">
                                    <div className="flex items-center gap-2 text-purple-700 mb-2">
                                        <User className="h-4 w-4" />
                                        <span className="font-medium">Entrada Asignada</span>
                                    </div>
                                    <p className="text-sm text-purple-600">
                                        Esta entrada está pre-asignada a: <strong>{codeData.assignedName}</strong>
                                        {codeData.assignedDniMasked && ` (DNI: ${codeData.assignedDniMasked})`}
                                    </p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-600">
                                        Ingresa los datos del asistente que usará esta entrada:
                                    </p>
                                    <div className="space-y-3">
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">Nombre Completo</label>
                                            <Input
                                                value={attendeeName}
                                                onChange={(e) => setAttendeeName(e.target.value)}
                                                placeholder="Juan Pérez García"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-sm font-medium">DNI / Documento</label>
                                            <Input
                                                value={attendeeDni}
                                                onChange={(e) => setAttendeeDni(e.target.value)}
                                                placeholder="12345678"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Claim Button */}
                            {status === "authenticated" ? (
                                <Button 
                                    className="w-full" 
                                    size="lg" 
                                    onClick={handleClaim}
                                    disabled={loading || (!codeData.hasAssignedAttendee && (!attendeeName || !attendeeDni))}
                                >
                                    {loading ? (
                                        <>
                                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent mr-2" />
                                            Canjeando...
                                        </>
                                    ) : (
                                        <>
                                            <Gift className="h-4 w-4 mr-2" />
                                            Canjear Mi Entrada
                                        </>
                                    )}
                                </Button>
                            ) : (
                                <div className="space-y-3">
                                    <p className="text-sm text-center text-gray-600">
                                        Debes iniciar sesión para canjear tu cortesía
                                    </p>
                                    <Button 
                                        className="w-full" 
                                        size="lg" 
                                        onClick={handleClaim}
                                    >
                                        Iniciar Sesión y Canjear
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                {/* Help Text */}
                <p className="text-center text-sm text-gray-500">
                    ¿Problemas con tu código?{" "}
                    <Link href="/contacto" className="text-purple-600 hover:underline">
                        Contáctanos
                    </Link>
                </p>
            </div>
        </div>
    )
}
