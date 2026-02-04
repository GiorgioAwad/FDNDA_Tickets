"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useCart } from "@/hooks/cart-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatPrice } from "@/lib/utils"
import { Info, ShoppingCart, Minus, Plus, Gift, CheckCircle, AlertCircle, Ticket } from "lucide-react"

export type TicketTypeClient = {
    id: string
    name: string
    description?: string | null
    price: number
    capacity: number
    sold: number
    isPackage?: boolean | null
    packageDaysCount?: number | null
}

type TicketPurchaseCardProps = {
    eventId: string
    eventTitle: string
    ticketTypes: TicketTypeClient[]
}

const MAX_UNLIMITED_QTY = 10

export default function TicketPurchaseCard({
    eventId,
    eventTitle,
    ticketTypes,
}: TicketPurchaseCardProps) {
    const { addItem, updateQuantity, removeItem, items, itemCount } = useCart()
    const { status } = useSession()
    const router = useRouter()

    // Courtesy claim state
    const [showCourtesy, setShowCourtesy] = useState(false)
    const [courtesyCode, setCourtesyCode] = useState("")
    const [courtesyLoading, setCourtesyLoading] = useState(false)
    const [courtesyError, setCourtesyError] = useState("")
    const [courtesyData, setCourtesyData] = useState<{
        ticketType: string
        hasAssignedAttendee: boolean
        assignedName: string | null
        assignedDniMasked: string | null
    } | null>(null)
    const [courtesySuccess, setCourtesySuccess] = useState(false)
    const [attendeeName, setAttendeeName] = useState("")
    const [attendeeDni, setAttendeeDni] = useState("")

    const ticketMeta = useMemo(() => {
        return ticketTypes.map((ticket) => {
            const available = ticket.capacity === 0 ? null : ticket.capacity - ticket.sold
            const maxQty = available === null ? MAX_UNLIMITED_QTY : Math.max(0, available)
            const soldOut = available !== null && available <= 0
            return { ticket, available, maxQty, soldOut }
        })
    }, [ticketTypes])

    const getCartQuantity = (ticketId: string) => {
        const found = items.find((item) => item.ticketTypeId === ticketId)
        return found?.quantity || 0
    }

    const handleIncrement = (ticketId: string, maxQty: number) => {
        const ticket = ticketTypes.find((item) => item.id === ticketId)
        if (!ticket) return
        if (maxQty <= 0) return

        const currentQty = getCartQuantity(ticketId)
        const nextQty = Math.min(currentQty + 1, maxQty)
        if (currentQty === 0) {
            addItem({
                ticketTypeId: ticket.id,
                ticketTypeName: ticket.name,
                eventId,
                eventTitle,
                price: ticket.price,
                quantity: 1,
            })
            return
        }
        updateQuantity(ticketId, nextQty)
    }

    const handleDecrement = (ticketId: string) => {
        const currentQty = getCartQuantity(ticketId)
        if (currentQty <= 1) {
            removeItem(ticketId)
            return
        }
        updateQuantity(ticketId, currentQty - 1)
    }

    // Courtesy functions
    const handleVerifyCourtesy = async () => {
        if (!courtesyCode.trim()) return
        setCourtesyLoading(true)
        setCourtesyError("")
        setCourtesyData(null)
        
        try {
            const res = await fetch(`/api/courtesy/claim?code=${encodeURIComponent(courtesyCode)}`)
            const data = await res.json()
            
            if (data.valid) {
                if (data.data.event.id !== eventId) {
                    setCourtesyError(`Este código es para: ${data.data.event.title}`)
                } else {
                    setCourtesyData(data.data)
                }
            } else {
                setCourtesyError(data.error || "Código no válido")
            }
        } catch {
            setCourtesyError("Error al verificar código")
        } finally {
            setCourtesyLoading(false)
        }
    }

    const handleClaimCourtesy = async () => {
        if (status !== "authenticated") {
            router.push(`/login?callbackUrl=/eventos/${encodeURIComponent(eventTitle.toLowerCase().replace(/\s+/g, '-'))}`)
            return
        }

        if (!courtesyData?.hasAssignedAttendee && (!attendeeName || !attendeeDni)) {
            setCourtesyError("Completa nombre y DNI")
            return
        }

        setCourtesyLoading(true)
        setCourtesyError("")

        try {
            const res = await fetch("/api/courtesy/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: courtesyCode,
                    attendeeName: courtesyData?.hasAssignedAttendee ? undefined : attendeeName,
                    attendeeDni: courtesyData?.hasAssignedAttendee ? undefined : attendeeDni,
                }),
            })
            const data = await res.json()
            if (data.success) {
                setCourtesySuccess(true)
            } else {
                setCourtesyError(data.error || "Error al canjear")
            }
        } catch {
            setCourtesyError("Error al canjear")
        } finally {
            setCourtesyLoading(false)
        }
    }

    const resetCourtesy = () => {
        setShowCourtesy(false)
        setCourtesyCode("")
        setCourtesyData(null)
        setCourtesyError("")
        setCourtesySuccess(false)
        setAttendeeName("")
        setAttendeeDni("")
    }

    return (
        <Card className="sticky top-24">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShoppingCart className="h-5 w-5" />
                    Entradas disponibles
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {ticketTypes.length > 0 ? (
                    <>
                        {ticketMeta.map(({ ticket, available, maxQty, soldOut }) => (
                            <div
                                key={ticket.id}
                                className={`p-4 rounded-lg border ${
                                    soldOut ? "bg-gray-50 opacity-60" : "bg-white"
                                }`}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div>
                                        <h4 className="font-semibold">{ticket.name}</h4>
                                        {ticket.description && (
                                            <p className="text-sm text-gray-500">{ticket.description}</p>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <div className="font-bold text-lg text-[hsl(210,100%,40%)]">
                                            {formatPrice(ticket.price)}
                                        </div>
                                    </div>
                                </div>

                                {ticket.isPackage && ticket.packageDaysCount ? (
                                    <Badge variant="info" className="mb-2">
                                        Paquete {ticket.packageDaysCount} clases
                                    </Badge>
                                ) : null}

                                {/* AGOTADO - Banner prominente */}
                                {soldOut && (
                                    <div className="bg-red-100 border border-red-300 rounded-lg p-3 mb-3">
                                        <div className="flex items-center gap-2 text-red-700 font-bold">
                                            <AlertCircle className="h-5 w-5" />
                                            <span className="text-lg">AGOTADO</span>
                                        </div>
                                        <p className="text-red-600 text-sm mt-1">
                                            No hay entradas disponibles para este tipo.
                                        </p>
                                    </div>
                                )}

                                <div className="flex flex-wrap items-center gap-3 mt-3">
                                    {!soldOut && available !== null && (
                                        <span className="text-sm text-green-600 font-medium">
                                            {available} disponibles
                                        </span>
                                    )}
                                    {!soldOut && available === null && (
                                        <span className="text-sm text-gray-500">Disponibilidad abierta</span>
                                    )}

                                    {!soldOut && (
                                        <div className="ml-auto flex items-center gap-2">
                                            <span className="text-xs text-gray-500">Cantidad</span>
                                            <div className="flex items-center gap-2 rounded-full border px-2 py-1">
                                                <button
                                                    type="button"
                                                    className="h-7 w-7 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                                    onClick={() => handleDecrement(ticket.id)}
                                                    disabled={getCartQuantity(ticket.id) === 0}
                                                    aria-label="Quitar"
                                                >
                                                    <Minus className="h-3 w-3 mx-auto" />
                                                </button>
                                                <span className="min-w-[1.5rem] text-center text-sm font-semibold">
                                                    {getCartQuantity(ticket.id)}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="h-7 w-7 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                                                    onClick={() => handleIncrement(ticket.id, maxQty)}
                                                    disabled={getCartQuantity(ticket.id) >= maxQty}
                                                    aria-label="Agregar"
                                                >
                                                    <Plus className="h-3 w-3 mx-auto" />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}

                        <div className="space-y-3 pt-2">
                            <Button asChild className="w-full" size="lg" disabled={itemCount === 0}>
                                <Link href="/checkout">Ir a pagar</Link>
                            </Button>
                            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
                                <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                <span>Debes tener una cuenta verificada para comprar entradas.</span>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-center py-6 text-gray-500">
                        <ShoppingCart className="h-12 w-12 mx-auto mb-2 text-gray-300" />
                        <p>Las entradas aun no estan disponibles</p>
                    </div>
                )}

                {/* Sección de Cortesía */}
                <div className="border-t mt-6 pt-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Gift className="h-5 w-5 text-purple-600" />
                        <h3 className="font-semibold text-gray-900">¿Tienes un código de cortesía?</h3>
                    </div>

                    {courtesySuccess ? (
                        <div className="text-center py-4">
                            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
                            <p className="text-green-700 font-medium mb-2">¡Entrada canjeada exitosamente!</p>
                            <p className="text-sm text-gray-600 mb-4">Tu entrada ha sido registrada</p>
                            <div className="flex flex-col gap-2">
                                <Button asChild>
                                    <Link href="/mi-cuenta/entradas">
                                        <Ticket className="h-4 w-4 mr-2" />
                                        Ver Mis Entradas
                                    </Link>
                                </Button>
                                <Button variant="outline" onClick={resetCourtesy}>
                                    Canjear otro código
                                </Button>
                            </div>
                        </div>
                    ) : courtesyData ? (
                        <div className="space-y-4">
                            <div className="p-3 rounded-lg bg-green-50 border border-green-200">
                                <p className="text-green-800 font-medium">Código válido</p>
                                <p className="text-sm text-green-700">Entrada: {courtesyData.ticketType}</p>
                            </div>
                            
                            {!courtesyData.hasAssignedAttendee && (
                                <div className="space-y-3">
                                    <p className="text-sm text-gray-600">
                                        Este código requiere que ingreses los datos del asistente:
                                    </p>
                                    <Input
                                        placeholder="Nombre completo del asistente"
                                        value={attendeeName}
                                        onChange={(e) => setAttendeeName(e.target.value)}
                                    />
                                    <Input
                                        placeholder="DNI del asistente"
                                        value={attendeeDni}
                                        onChange={(e) => setAttendeeDni(e.target.value)}
                                    />
                                </div>
                            )}

                            {courtesyData.hasAssignedAttendee && (
                                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200">
                                    <p className="text-sm text-blue-700">
                                        <span className="font-medium">Asignado a:</span> {courtesyData.assignedName} ({courtesyData.assignedDniMasked})
                                    </p>
                                </div>
                            )}
                            
                            {courtesyError && (
                                <div className="flex items-center gap-2 text-red-600 text-sm">
                                    <AlertCircle className="h-4 w-4" />
                                    {courtesyError}
                                </div>
                            )}

                            <div className="flex gap-2">
                                <Button
                                    onClick={handleClaimCourtesy}
                                    disabled={courtesyLoading}
                                    className="flex-1"
                                >
                                    {courtesyLoading ? 'Canjeando...' : 'Canjear entrada'}
                                </Button>
                                <Button variant="outline" onClick={resetCourtesy}>
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <Input
                                    placeholder="Ingresa tu código de cortesía"
                                    value={courtesyCode}
                                    onChange={(e) => setCourtesyCode(e.target.value.toUpperCase())}
                                    className="flex-1 font-mono"
                                />
                                <Button
                                    onClick={handleVerifyCourtesy}
                                    disabled={courtesyLoading || !courtesyCode.trim()}
                                >
                                    {courtesyLoading ? 'Verificando...' : 'Verificar'}
                                </Button>
                            </div>
                            
                            {courtesyError && (
                                <div className="flex items-center gap-2 text-red-600 text-sm">
                                    <AlertCircle className="h-4 w-4" />
                                    {courtesyError}
                                </div>
                            )}
                            
                            <p className="text-xs text-gray-500">
                                Si recibiste un código de cortesía, ingrésalo aquí para obtener tu entrada gratuita.
                            </p>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
