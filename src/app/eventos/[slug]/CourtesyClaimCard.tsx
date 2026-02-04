"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Gift, CheckCircle, AlertCircle, Ticket } from "lucide-react"
import Link from "next/link"

interface CourtesyClaimCardProps {
    eventId: string
    eventTitle: string
}

type CodeData = {
    event: { id: string; title: string }
    ticketType: string
    hasAssignedAttendee: boolean
    assignedName: string | null
    assignedDniMasked: string | null
}

export default function CourtesyClaimCard({ eventId, eventTitle }: CourtesyClaimCardProps) {
    const { data: session, status } = useSession()
    const router = useRouter()
    
    const [isExpanded, setIsExpanded] = useState(false)
    const [code, setCode] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [codeData, setCodeData] = useState<CodeData | null>(null)
    const [success, setSuccess] = useState(false)
    
    // Form para datos de asistente
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
                // Verificar que sea para este evento
                if (data.data.event.id !== eventId) {
                    setError(`Este código es para otro evento: ${data.data.event.title}`)
                } else {
                    setCodeData(data.data)
                }
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
            router.push(`/login?callbackUrl=/eventos/${encodeURIComponent(eventTitle.toLowerCase().replace(/\s+/g, '-'))}`)
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

    const resetForm = () => {
        setCode("")
        setCodeData(null)
        setError("")
        setSuccess(false)
        setAttendeeName("")
        setAttendeeDni("")
        setIsExpanded(false)
    }

    if (success) {
        return (
            <div className="rounded-lg border bg-green-50 border-green-200 p-6 text-center">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <CheckCircle className="h-6 w-6 text-green-600" />
                </div>
                <h3 className="font-bold text-green-800 mb-2">¡Entrada Canjeada!</h3>
                <p className="text-sm text-green-700 mb-4">
                    Tu entrada ha sido agregada a tu cuenta
                </p>
                <div className="space-y-2">
                    <Button asChild size="sm" className="w-full">
                        <Link href="/mi-cuenta/entradas">
                            <Ticket className="h-4 w-4 mr-2" />
                            Ver Mis Entradas
                        </Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={resetForm} className="w-full">
                        Canjear otro código
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="rounded-lg border bg-card p-4">
            {!isExpanded ? (
                <button
                    onClick={() => setIsExpanded(true)}
                    className="w-full flex items-center justify-center gap-2 py-2 text-purple-600 hover:text-purple-700 transition-colors"
                >
                    <Gift className="h-5 w-5" />
                    <span className="font-medium">¿Tienes un código de cortesía?</span>
                </button>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-purple-600 mb-2">
                        <Gift className="h-5 w-5" />
                        <span className="font-semibold">Canjear Cortesía</span>
                    </div>

                        {!codeData ? (
                            <>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium">Código de Cortesía</label>
                                    <div className="flex gap-2">
                                        <Input
                                            value={code}
                                            onChange={(e) => setCode(e.target.value.toUpperCase())}
                                            placeholder="Ej: A1B2C3D4"
                                            className="uppercase font-mono"
                                            onKeyDown={(e) => e.key === "Enter" && handleVerifyCode()}
                                        />
                                        <Button 
                                            onClick={handleVerifyCode} 
                                            disabled={loading || !code.trim()}
                                            size="sm"
                                        >
                                            {loading ? "..." : "Verificar"}
                                        </Button>
                                    </div>
                                </div>
                                
                                {error && (
                                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-2 rounded">
                                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}
                                
                                <button
                                    onClick={() => setIsExpanded(false)}
                                    className="text-sm text-gray-500 hover:text-gray-700"
                                >
                                    Cancelar
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="bg-purple-50 p-3 rounded-lg">
                                    <p className="text-sm text-purple-700 font-medium">{codeData.ticketType}</p>
                                    <p className="text-xs text-purple-600">Entrada válida para este evento</p>
                                </div>

                                {codeData.hasAssignedAttendee ? (
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                        <p className="text-sm font-medium">Asistente pre-asignado:</p>
                                        <p className="text-sm text-gray-600">
                                            {codeData.assignedName} {codeData.assignedDniMasked && `(${codeData.assignedDniMasked})`}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <p className="text-xs text-gray-600">Ingresa los datos del asistente:</p>
                                        <Input
                                            value={attendeeName}
                                            onChange={(e) => setAttendeeName(e.target.value)}
                                            placeholder="Nombre completo"
                                        />
                                        <Input
                                            value={attendeeDni}
                                            onChange={(e) => setAttendeeDni(e.target.value)}
                                            placeholder="DNI / Documento"
                                        />
                                    </div>
                                )}

                                {error && (
                                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-2 rounded">
                                        <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <Button 
                                        onClick={handleClaim}
                                        disabled={loading || (!codeData.hasAssignedAttendee && (!attendeeName || !attendeeDni))}
                                        className="flex-1"
                                    >
                                        {loading ? "Canjeando..." : status === "authenticated" ? "Canjear Entrada" : "Iniciar Sesión"}
                                    </Button>
                                    <Button variant="outline" onClick={resetForm}>
                                        Cancelar
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}
        </div>
    )
}
