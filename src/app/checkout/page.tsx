"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useCart } from "@/hooks/cart-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { formatPrice } from "@/lib/utils"
import { Trash2, CreditCard, User, AlertCircle, ArrowLeft, Tag, CheckCircle, X } from "lucide-react"

type AppliedDiscount = {
    id: string
    code: string
    type: "PERCENTAGE" | "FIXED"
    value: number
    description: string | null
}

export default function CheckoutPage() {
    const router = useRouter()
    const { data: session, status } = useSession()
    const { items, removeItem, updateQuantity, updateAttendee, total, clearCart } = useCart()
    const paymentsMode =
        process.env.NEXT_PUBLIC_PAYMENTS_MODE ||
        (process.env.NODE_ENV === "production" ? "izipay" : "mock")

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    
    // Discount code state
    const [discountCode, setDiscountCode] = useState("")
    const [discountLoading, setDiscountLoading] = useState(false)
    const [discountError, setDiscountError] = useState("")
    const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null)
    const [discountAmount, setDiscountAmount] = useState(0)

    // If coming from event page with a pre-selected ticket
    // This logic would be handled by the component that adds to cart, 
    // but we can also handle direct links here if needed.
    // For now, we assume items are already in cart via useCart.

    const handleApplyDiscount = async () => {
        if (!discountCode.trim()) return
        
        setDiscountLoading(true)
        setDiscountError("")
        
        try {
            const res = await fetch("/api/discounts/validate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: discountCode,
                    eventId: items[0]?.eventId,
                    subtotal: total,
                }),
            })
            
            const data = await res.json()
            
            if (data.valid) {
                setAppliedDiscount(data.discount)
                setDiscountAmount(data.discountAmount)
                setDiscountCode("")
            } else {
                setDiscountError(data.error || "Código no válido")
            }
        } catch {
            setDiscountError("Error al validar código")
        } finally {
            setDiscountLoading(false)
        }
    }
    
    const handleRemoveDiscount = () => {
        setAppliedDiscount(null)
        setDiscountAmount(0)
    }
    
    const finalTotal = Math.max(0, total - discountAmount)

    const handlePayment = async () => {
        if (status !== "authenticated") {
            router.push("/login?callbackUrl=/checkout")
            return
        }

        if (!session.user.emailVerified) {
            setError("Debes verificar tu email antes de comprar")
            return
        }

        setLoading(true)
        setError("")

        try {
            // 1. Create Order
            const orderResponse = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    eventId: items[0]?.eventId, // Assuming all items are from same event for now
                    items: items.map((item) => ({
                        ticketTypeId: item.ticketTypeId,
                        quantity: item.quantity,
                        attendees: item.attendees,
                    })),
                    discountCodeId: appliedDiscount?.id || null,
                }),
            })

            const orderData = await orderResponse.json()

            if (!orderResponse.ok) {
                throw new Error(orderData.error || "Error al crear la orden")
            }

            if (paymentsMode !== "mock") {
                throw new Error("Pago IZIPAY no configurado para este entorno")
            }

            const paymentResponse = await fetch("/api/payments/mock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: orderData.data.orderId }),
            })

            const paymentData = await paymentResponse.json()

            if (!paymentResponse.ok) {
                throw new Error(paymentData.error || "Error al procesar el pago")
            }

            router.push(`/checkout/success?orderId=${orderData.data.orderId}`)
            clearCart()

        } catch (err) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }

    if (items.length === 0) {
        return (
            <div className="container mx-auto px-4 py-16 text-center">
                <h1 className="text-2xl font-bold mb-4">Tu carrito está vacío</h1>
                <p className="text-gray-600 mb-8">No has seleccionado ninguna entrada.</p>
                <Button onClick={() => router.push("/eventos")}>
                    Ver Eventos
                </Button>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 py-12">
            <div className="container mx-auto px-4">
                <div className="flex flex-col gap-3 mb-8">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 w-fit text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                        onClick={() => router.back()}
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Volver
                    </Button>
                    <h1 className="text-3xl font-bold">Finalizar Compra</h1>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Cart Items & Attendees */}
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Tus Entradas</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {items.map((item) => (
                                    <div key={item.ticketTypeId} className="border-b last:border-0 pb-6 last:pb-0">
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <h3 className="font-bold text-lg">{item.eventTitle}</h3>
                                                <p className="text-gray-600">{item.ticketTypeName}</p>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-bold">{formatPrice(item.price * item.quantity)}</div>
                                                <div className="text-sm text-gray-500">
                                                    {formatPrice(item.price)} x {item.quantity}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4 mb-4">
                                            <div className="flex items-center border rounded-md">
                                                <button
                                                    className="px-3 py-1 hover:bg-gray-100"
                                                    onClick={() => updateQuantity(item.ticketTypeId, item.quantity - 1)}
                                                >
                                                    -
                                                </button>
                                                <span className="px-3 py-1 font-medium">{item.quantity}</span>
                                                <button
                                                    className="px-3 py-1 hover:bg-gray-100"
                                                    onClick={() => updateQuantity(item.ticketTypeId, item.quantity + 1)}
                                                >
                                                    +
                                                </button>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                                onClick={() => removeItem(item.ticketTypeId)}
                                            >
                                                <Trash2 className="h-4 w-4 mr-2" />
                                                Eliminar
                                            </Button>
                                        </div>

                                        {/* Attendees Form */}
                                        <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                                <User className="h-4 w-4" />
                                                Datos de los asistentes
                                            </h4>
                                            {item.attendees.map((attendee, index) => (
                                                <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="text-xs text-gray-500 mb-1 block">
                                                            Nombre completo (Entrada #{index + 1})
                                                        </label>
                                                        <Input
                                                            value={attendee.name}
                                                            onChange={(e) =>
                                                                updateAttendee(item.ticketTypeId, index, "name", e.target.value)
                                                            }
                                                            placeholder="Nombre y Apellido"
                                                            className="bg-white"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-xs text-gray-500 mb-1 block">
                                                            DNI / Pasaporte
                                                        </label>
                                                        <Input
                                                            value={attendee.dni}
                                                            onChange={(e) =>
                                                                updateAttendee(item.ticketTypeId, index, "dni", e.target.value)
                                                            }
                                                            placeholder="Número de documento"
                                                            className="bg-white"
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                            <div className="text-xs text-gray-500">
                                                * Importante: El DNI debe coincidir con el documento de identidad al ingresar.
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Order Summary */}
                    <div className="space-y-6">
                        <Card className="sticky top-24">
                            <CardHeader>
                                <CardTitle>Resumen de Pago</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {/* Discount Code Input */}
                                {!appliedDiscount ? (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Tag className="h-4 w-4 text-gray-500" />
                                            Código de descuento
                                        </label>
                                        <div className="flex gap-2">
                                            <Input
                                                value={discountCode}
                                                onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                                                placeholder="FDNDA20"
                                                className="uppercase"
                                                onKeyDown={(e) => e.key === "Enter" && handleApplyDiscount()}
                                            />
                                            <Button
                                                variant="outline"
                                                onClick={handleApplyDiscount}
                                                disabled={discountLoading || !discountCode.trim()}
                                            >
                                                {discountLoading ? "..." : "Aplicar"}
                                            </Button>
                                        </div>
                                        {discountError && (
                                            <p className="text-xs text-red-500">{discountError}</p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <CheckCircle className="h-4 w-4 text-green-600" />
                                                <div>
                                                    <p className="font-medium text-green-800">{appliedDiscount.code}</p>
                                                    <p className="text-xs text-green-600">
                                                        {appliedDiscount.type === "PERCENTAGE"
                                                            ? `${appliedDiscount.value}% de descuento`
                                                            : `S/ ${appliedDiscount.value.toFixed(2)} de descuento`}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={handleRemoveDiscount}
                                                className="p-1 hover:bg-green-100 rounded"
                                            >
                                                <X className="h-4 w-4 text-green-600" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="border-t pt-4 space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Subtotal</span>
                                        <span>{formatPrice(total)}</span>
                                    </div>
                                    {appliedDiscount && (
                                        <div className="flex justify-between text-sm text-green-600">
                                            <span>Descuento ({appliedDiscount.code})</span>
                                            <span>-{formatPrice(discountAmount)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between text-sm">
                                        <span className="text-gray-600">Comisión de servicio</span>
                                        <span>{formatPrice(0)}</span>
                                    </div>
                                </div>
                                <div className="border-t pt-4 flex justify-between font-bold text-lg">
                                    <span>Total</span>
                                    <span>{formatPrice(finalTotal)}</span>
                                </div>

                                {error && (
                                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-start gap-2">
                                        <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        <span>{error}</span>
                                    </div>
                                )}

                                <Button
                                    className="w-full"
                                    size="lg"
                                    onClick={handlePayment}
                                    loading={loading}
                                    disabled={items.some(i => i.attendees.some(a => !a.name || !a.dni))}
                                >
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    Pagar {formatPrice(finalTotal)}
                                </Button>

                                {items.some(i => i.attendees.some(a => !a.name || !a.dni)) && (
                                    <p className="text-xs text-amber-600 text-center">
                                        Completa los datos de todos los asistentes para continuar
                                    </p>
                                )}

                                <div className="text-xs text-gray-500 text-center mt-4">
                                    Pagos procesados de forma segura por IZIPAY
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    )
}
