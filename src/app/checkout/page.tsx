"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useCart } from "@/hooks/cart-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { buildNaturalPersonFullName } from "@/lib/billing"
import { formatDate, formatPrice } from "@/lib/utils"
import type { IzipayCheckoutConfig } from "@/lib/izipay"
import { Trash2, CreditCard, User, AlertCircle, ArrowLeft, Tag, CheckCircle, X, FileText } from "lucide-react"
import AuthModal from "@/components/auth/AuthModal"

const IzipayCheckout = dynamic(
    () => import("@/components/checkout/izipay-checkout"),
    { ssr: false }
)

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
    const {
        items,
        removeItem,
        updateQuantity,
        updateAttendee,
        updateAttendeeScheduleSelection,
        billingData,
        updateBillingData,
        total,
        clearCart,
    } = useCart()
    const paymentsMode =
        process.env.NEXT_PUBLIC_PAYMENTS_MODE ||
        (process.env.NODE_ENV === "production" ? "izipay" : "mock")

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")

    const [izipayCheckoutData, setIzipayCheckoutData] = useState<{
        authorization: string
        keyRSA: string
        scriptUrl: string
        config: IzipayCheckoutConfig
        orderId: string
    } | null>(null)

    const [showAuthModal, setShowAuthModal] = useState(false)
    const [discountCode, setDiscountCode] = useState("")
    const [discountLoading, setDiscountLoading] = useState(false)
    const [discountError, setDiscountError] = useState("")
    const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null)
    const [discountAmount, setDiscountAmount] = useState(0)

    const getRequiredSelections = useCallback((item: (typeof items)[number]) => {
        if (!item.scheduleConfig) return 0
        if (
            typeof item.scheduleConfig.requiredDays === "number" &&
            item.scheduleConfig.requiredDays > 0
        ) {
            return item.scheduleConfig.requiredDays
        }
        return item.scheduleConfig.dates.length > 0 ? 1 : 0
    }, [])

    const boletaFullName = useMemo(
        () =>
            buildNaturalPersonFullName({
                firstName: billingData.buyerFirstName,
                secondName: billingData.buyerSecondName,
                lastNamePaternal: billingData.buyerLastNamePaternal,
                lastNameMaternal: billingData.buyerLastNameMaternal,
            }),
        [
            billingData.buyerFirstName,
            billingData.buyerSecondName,
            billingData.buyerLastNamePaternal,
            billingData.buyerLastNameMaternal,
        ]
    )

    useEffect(() => {
        if (status !== "authenticated") return
        if (!session?.user?.email || billingData.buyerEmail) return
        updateBillingData("buyerEmail", session.user.email)
    }, [status, session?.user?.email, billingData.buyerEmail, updateBillingData])

    const hasMissingAttendeeData = useMemo(
        () =>
            items.some((item) =>
                item.attendees.some((attendee) =>
                    !attendee.name ||
                    !attendee.dni ||
                    (item.servilexEnabled && !attendee.matricula)
                )
            ),
        [items]
    )

    const hasMissingBillingData = useMemo(() => {
        if (!billingData.buyerDocNumber || !billingData.buyerAddress) return true
        if (!billingData.buyerEmail || !/^\S+@\S+\.\S+$/.test(billingData.buyerEmail)) return true
        if (!billingData.buyerPhone || !/^\d{7,15}$/.test(billingData.buyerPhone)) return true
        if (!billingData.buyerUbigeo || !/^\d{5,6}$/.test(billingData.buyerUbigeo)) return true
        if (billingData.documentType === "BOLETA" && !/^\d{8}$/.test(billingData.buyerDocNumber)) return true
        if (billingData.documentType === "FACTURA") {
            if (!/^\d{11}$/.test(billingData.buyerDocNumber)) return true
            if (!billingData.buyerName || billingData.buyerName.trim().length < 2) return true
            return false
        }
        return (
            !billingData.buyerFirstName ||
            !billingData.buyerLastNamePaternal ||
            !billingData.buyerLastNameMaternal ||
            !boletaFullName
        )
    }, [billingData, boletaFullName])

    const hasMissingScheduleSelections = useMemo(() => {
        return items.some((item) => {
            const requiredSelections = getRequiredSelections(item)
            if (requiredSelections === 0) return false

            const requiresShift =
                (item.scheduleConfig?.shifts.length || 0) > 0 &&
                (item.scheduleConfig?.requireShiftSelection ?? true)
            return item.attendees.some((attendee) => {
                const selections = attendee.scheduleSelections ?? []
                if (selections.length < requiredSelections) return true

                const selectedDates = new Set<string>()
                for (let i = 0; i < requiredSelections; i++) {
                    const selection = selections[i]
                    if (!selection?.date) return true
                    if (selectedDates.has(selection.date)) return true
                    selectedDates.add(selection.date)
                    if (requiresShift && !selection?.shift) return true
                }
                return false
            })
        })
    }, [getRequiredSelections, items])

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
                setDiscountError(data.error || "Codigo no valido")
            }
        } catch {
            setDiscountError("Error al validar codigo")
        } finally {
            setDiscountLoading(false)
        }
    }

    const handleRemoveDiscount = () => {
        setAppliedDiscount(null)
        setDiscountAmount(0)
    }

    const finalTotal = Math.max(0, total - discountAmount)

    const handleAuthSuccess = () => {
        setShowAuthModal(false)
        router.refresh()
    }

    const handlePayment = async () => {
        if (status !== "authenticated") {
            setShowAuthModal(true)
            return
        }

        if (!session.user.emailVerified) {
            setError("Debes verificar tu email antes de comprar")
            return
        }

        setLoading(true)
        setError("")

        try {
            const orderResponse = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    eventId: items[0]?.eventId,
                    items: items.map((item) => ({
                        ticketTypeId: item.ticketTypeId,
                        quantity: item.quantity,
                        attendees: item.attendees,
                    })),
                    billing: {
                        documentType: billingData.documentType,
                        buyerDocNumber: billingData.buyerDocNumber,
                        buyerName: billingData.documentType === "FACTURA" ? billingData.buyerName : boletaFullName,
                        buyerAddress: billingData.buyerAddress,
                        buyerEmail: billingData.buyerEmail,
                        buyerPhone: billingData.buyerPhone,
                        buyerUbigeo: billingData.buyerUbigeo,
                        buyerFirstName: billingData.buyerFirstName,
                        buyerSecondName: billingData.buyerSecondName,
                        buyerLastNamePaternal: billingData.buyerLastNamePaternal,
                        buyerLastNameMaternal: billingData.buyerLastNameMaternal,
                    },
                    discountCodeId: appliedDiscount?.id || null,
                }),
            })

            const orderData = await orderResponse.json()

            if (!orderResponse.ok) {
                throw new Error(orderData.error || "Error al crear la orden")
            }

            if (paymentsMode === "mock") {
                const paymentResponse = await fetch("/api/payments/mock", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ orderId: orderData.data.orderId }),
                })

                const paymentData = await paymentResponse.json()

                if (!paymentResponse.ok) {
                    throw new Error(paymentData.error || "Error al procesar el pago")
                }

                clearCart()
                router.push(`/checkout/success?orderId=${orderData.data.orderId}`)
                return
            }

            // OpenPay redirect flow
            if (paymentsMode === "openpay") {
                const openpayResponse = await fetch("/api/payments/openpay/charge", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ orderId: orderData.data.orderId }),
                })

                const openpayData = await openpayResponse.json()

                if (!openpayResponse.ok || !openpayData.success) {
                    throw new Error(openpayData.error || "Error al procesar el pago con OpenPay")
                }

                if (openpayData.data?.alreadyPaid) {
                    clearCart()
                    router.push(`/checkout/success?orderId=${orderData.data.orderId}`)
                    return
                }

                clearCart()
                window.location.assign(openpayData.data.paymentUrl)
                return
            }

            const sessionResponse = await fetch("/api/payments/izipay/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ orderId: orderData.data.orderId }),
            })

            const sessionData = await sessionResponse.json()

            if (!sessionResponse.ok || !sessionData.success) {
                throw new Error(sessionData.error || "No se pudo iniciar el pago con IZIPAY")
            }

            if (sessionData.data?.alreadyPaid) {
                clearCart()
                router.push(`/checkout/success?orderId=${orderData.data.orderId}`)
                return
            }

            if (
                sessionData.data?.authorization &&
                sessionData.data?.keyRSA &&
                sessionData.data?.scriptUrl &&
                sessionData.data?.config
            ) {
                setIzipayCheckoutData({
                    authorization: sessionData.data.authorization,
                    keyRSA: sessionData.data.keyRSA,
                    scriptUrl: sessionData.data.scriptUrl,
                    config: sessionData.data.config,
                    orderId: orderData.data.orderId,
                })
                return
            }

            throw new Error("IZIPAY no devolvio datos suficientes para abrir el checkout")
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }

    if (items.length === 0) {
        return (
            <div className="container mx-auto px-4 py-16 text-center">
                <h1 className="text-2xl font-bold mb-4">Tu carrito esta vacio</h1>
                <p className="text-gray-600 mb-8">No has seleccionado ninguna entrada.</p>
                <Button onClick={() => router.push("/eventos")}>
                    Ver eventos
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
                    <h1 className="text-3xl font-bold">Finalizar compra</h1>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-6">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <FileText className="h-5 w-5" />
                                    Comprobante de pago
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex gap-4">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="documentType"
                                            value="BOLETA"
                                            checked={billingData.documentType === "BOLETA"}
                                            onChange={() => updateBillingData("documentType", "BOLETA")}
                                            className="accent-black"
                                        />
                                        <span className="text-sm font-medium">Boleta de Venta</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="documentType"
                                            value="FACTURA"
                                            checked={billingData.documentType === "FACTURA"}
                                            onChange={() => updateBillingData("documentType", "FACTURA")}
                                            className="accent-black"
                                        />
                                        <span className="text-sm font-medium">Factura</span>
                                    </label>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-500 mb-1 block">
                                            {billingData.documentType === "BOLETA" ? "DNI" : "RUC"}
                                        </label>
                                        <Input
                                            value={billingData.buyerDocNumber}
                                            onChange={(e) => {
                                                const value = e.target.value.replace(/\D/g, "")
                                                const maxLen = billingData.documentType === "BOLETA" ? 8 : 11
                                                updateBillingData("buyerDocNumber", value.slice(0, maxLen))
                                            }}
                                            placeholder={billingData.documentType === "BOLETA" ? "12345678" : "20123456789"}
                                            maxLength={billingData.documentType === "BOLETA" ? 8 : 11}
                                            className="bg-white"
                                        />
                                        {billingData.buyerDocNumber && (
                                            billingData.documentType === "BOLETA"
                                                ? !/^\d{8}$/.test(billingData.buyerDocNumber) && (
                                                    <p className="text-xs text-red-500 mt-1">DNI debe tener 8 dígitos</p>
                                                )
                                                : !/^\d{11}$/.test(billingData.buyerDocNumber) && (
                                                    <p className="text-xs text-red-500 mt-1">RUC debe tener 11 dígitos</p>
                                                )
                                        )}
                                    </div>
                                    {billingData.documentType === "FACTURA" && (
                                        <div>
                                            <label className="text-xs text-gray-500 mb-1 block">
                                                Razón social
                                            </label>
                                            <Input
                                                value={billingData.buyerName}
                                                onChange={(e) => updateBillingData("buyerName", e.target.value)}
                                                placeholder="Empresa S.A.C."
                                                className="bg-white"
                                            />
                                        </div>
                                    )}
                                </div>

                                {billingData.documentType === "FACTURA" && (
                                    <div>
                                        <label className="text-xs text-gray-500 mb-1 block">
                                            Dirección fiscal
                                        </label>
                                        <Input
                                            value={billingData.buyerAddress}
                                            onChange={(e) => updateBillingData("buyerAddress", e.target.value)}
                                            placeholder="Av. ejemplo 123, Lima"
                                            className="bg-white"
                                        />
                                        {billingData.buyerAddress && billingData.buyerAddress.length < 5 && (
                                            <p className="text-xs text-red-500 mt-1">Dirección fiscal debe tener al menos 5 caracteres</p>
                                        )}
                                    </div>
                                )}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-500 mb-1 block">Email para comprobante</label>
                                        <Input
                                            type="email"
                                            value={billingData.buyerEmail}
                                            onChange={(e) => updateBillingData("buyerEmail", e.target.value)}
                                            placeholder="cliente@correo.com"
                                            className="bg-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500 mb-1 block">Celular</label>
                                        <Input
                                            value={billingData.buyerPhone}
                                            onChange={(e) => updateBillingData("buyerPhone", e.target.value.replace(/\D/g, "").slice(0, 15))}
                                            placeholder="999888777"
                                            className="bg-white"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-500 mb-1 block">Ubigeo</label>
                                        <Input
                                            value={billingData.buyerUbigeo}
                                            onChange={(e) => updateBillingData("buyerUbigeo", e.target.value.replace(/\D/g, "").slice(0, 6))}
                                            placeholder="150101"
                                            className="bg-white"
                                        />
                                    </div>
                                </div>

                                {billingData.documentType === "BOLETA" && (
                                    <div>
                                        <label className="text-xs text-gray-500 mb-1 block">Direccion</label>
                                        <Input
                                            value={billingData.buyerAddress}
                                            onChange={(e) => updateBillingData("buyerAddress", e.target.value)}
                                            placeholder="Av. ejemplo 123, Lima"
                                            className="bg-white"
                                        />
                                    </div>
                                )}

                                {billingData.documentType === "BOLETA" && (
                                    <>
                                        <div className="text-xs text-gray-500 bg-gray-100 rounded-md px-3 py-2">
                                            Para boleta, el nombre completo se arma con los nombres y apellidos de abajo.
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Primer nombre</label>
                                                <Input
                                                    value={billingData.buyerFirstName}
                                                    onChange={(e) => updateBillingData("buyerFirstName", e.target.value)}
                                                    placeholder="Juan"
                                                    className="bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Segundo nombre</label>
                                                <Input
                                                    value={billingData.buyerSecondName}
                                                    onChange={(e) => updateBillingData("buyerSecondName", e.target.value)}
                                                    placeholder="Carlos"
                                                    className="bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Apellido paterno</label>
                                                <Input
                                                    value={billingData.buyerLastNamePaternal}
                                                    onChange={(e) => updateBillingData("buyerLastNamePaternal", e.target.value)}
                                                    placeholder="Perez"
                                                    className="bg-white"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 mb-1 block">Apellido materno</label>
                                                <Input
                                                    value={billingData.buyerLastNameMaternal}
                                                    onChange={(e) => updateBillingData("buyerLastNameMaternal", e.target.value)}
                                                    placeholder="Lopez"
                                                    className="bg-white"
                                                />
                                            </div>
                                        </div>
                                        {boletaFullName && (
                                            <div className="text-xs text-gray-500 bg-gray-100 rounded-md px-3 py-2">
                                                Nombre completo para comprobante: <span className="font-medium text-gray-700">{boletaFullName}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Tus entradas</CardTitle>
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

                                        <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                                            <h4 className="text-sm font-semibold flex items-center gap-2">
                                                <User className="h-4 w-4" />
                                                Datos de los asistentes
                                            </h4>

                                            {item.attendees.map((attendee, attendeeIndex) => {
                                                const requiredSelections = getRequiredSelections(item)
                                                const scheduleConfig = item.scheduleConfig

                                                return (
                                                    <div key={attendeeIndex} className="space-y-3">
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div>
                                                            <label className="text-xs text-gray-500 mb-1 block">
                                                                Nombre completo (Entrada #{attendeeIndex + 1})
                                                            </label>
                                                            <Input
                                                                value={attendee.name}
                                                                onChange={(e) =>
                                                                    updateAttendee(
                                                                        item.ticketTypeId,
                                                                        attendeeIndex,
                                                                        "name",
                                                                        e.target.value
                                                                    )
                                                                }
                                                                placeholder="Nombre y apellido"
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
                                                                    updateAttendee(
                                                                        item.ticketTypeId,
                                                                        attendeeIndex,
                                                                        "dni",
                                                                        e.target.value
                                                                    )
                                                                }
                                                                placeholder="Numero de documento"
                                                                className="bg-white"
                                                            />
                                                        </div>
                                                    </div>

                                                    {item.servilexEnabled && (
                                                        <div>
                                                            <label className="text-xs text-gray-500 mb-1 block">
                                                                Matricula / codigo de referencia Servilex
                                                            </label>
                                                            <Input
                                                                value={attendee.matricula || ""}
                                                                onChange={(e) =>
                                                                    updateAttendee(
                                                                        item.ticketTypeId,
                                                                        attendeeIndex,
                                                                        "matricula",
                                                                        e.target.value
                                                                    )
                                                                }
                                                                placeholder="0000006"
                                                                className="bg-white"
                                                            />
                                                        </div>
                                                    )}

                                                        {requiredSelections > 0 && scheduleConfig && (
                                                        <div className="rounded-md border border-dashed border-gray-300 p-3 bg-white">
                                                            <p className="text-xs font-medium text-gray-700 mb-2">
                                                                Selecciona dia y turno
                                                            </p>
                                                            <div className="space-y-2">
                                                                {Array.from({ length: requiredSelections }).map((_, selectionIndex) => {
                                                                    const selection =
                                                                        attendee.scheduleSelections?.[selectionIndex] ?? { date: "", shift: "" }
                                                                    return (
                                                                        <div key={selectionIndex} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                            <div>
                                                                                <label className="text-[11px] text-gray-500 mb-1 block">
                                                                                    Dia {selectionIndex + 1}
                                                                                </label>
                                                                                <select
                                                                                    value={selection.date}
                                                                                    onChange={(e) =>
                                                                                        updateAttendeeScheduleSelection(
                                                                                            item.ticketTypeId,
                                                                                            attendeeIndex,
                                                                                            selectionIndex,
                                                                                            "date",
                                                                                            e.target.value
                                                                                        )
                                                                                    }
                                                                                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                                                                >
                                                                                    <option value="">Seleccionar dia</option>
                                                                                    {scheduleConfig.dates.map((date) => (
                                                                                        <option key={date} value={date}>
                                                                                            {formatDate(date, { dateStyle: "full" })}
                                                                                        </option>
                                                                                    ))}
                                                                                </select>
                                                                            </div>
                                                                            {scheduleConfig.shifts.length > 0 && (scheduleConfig.requireShiftSelection ?? true) && (
                                                                                <div>
                                                                                    <label className="text-[11px] text-gray-500 mb-1 block">
                                                                                        Turno
                                                                                    </label>
                                                                                    <select
                                                                                        value={selection.shift}
                                                                                        onChange={(e) =>
                                                                                            updateAttendeeScheduleSelection(
                                                                                                item.ticketTypeId,
                                                                                                attendeeIndex,
                                                                                                selectionIndex,
                                                                                                "shift",
                                                                                                e.target.value
                                                                                            )
                                                                                        }
                                                                                        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                                                                                    >
                                                                                        <option value="">Seleccionar turno</option>
                                                                                        {scheduleConfig.shifts.map((shift) => (
                                                                                            <option key={shift} value={shift}>
                                                                                                {shift}
                                                                                            </option>
                                                                                        ))}
                                                                                    </select>
                                                                                </div>
                                                                            )}
                                                                            {scheduleConfig.shifts.length > 0 && !(scheduleConfig.requireShiftSelection ?? true) && (
                                                                                <div className="md:col-span-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                                                                                    Incluye todos los turnos configurados para ese dia ({scheduleConfig.shifts.join(", ")}).
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                    </div>
                                                )
                                            })}

                                            <div className="text-xs text-gray-500">
                                                * Importante: El DNI debe coincidir con el documento de identidad al ingresar.
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>

                    <div className="space-y-6">
                        <Card className="sticky top-24">
                            <CardHeader>
                                <CardTitle>Resumen de pago</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {!appliedDiscount ? (
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Tag className="h-4 w-4 text-gray-500" />
                                            Codigo de descuento
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
                                        <span className="text-gray-600">Comision de servicio</span>
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

                                {izipayCheckoutData ? (
                                    <IzipayCheckout
                                        authorization={izipayCheckoutData.authorization}
                                        keyRSA={izipayCheckoutData.keyRSA}
                                        scriptUrl={izipayCheckoutData.scriptUrl}
                                        config={izipayCheckoutData.config}
                                        orderId={izipayCheckoutData.orderId}
                                        onSuccess={() => clearCart()}
                                        onError={(msg) => setError(msg)}
                                    />
                                ) : (
                                    <>
                                        <Button
                                            className="w-full"
                                            size="lg"
                                            onClick={handlePayment}
                                            loading={loading}
                                            disabled={hasMissingAttendeeData || hasMissingScheduleSelections || hasMissingBillingData}
                                        >
                                            <CreditCard className="h-4 w-4 mr-2" />
                                            Pagar {formatPrice(finalTotal)}
                                        </Button>

                                        {hasMissingBillingData && (
                                            <p className="text-xs text-amber-600 text-center">
                                                Completa los datos del comprobante de pago
                                            </p>
                                        )}
                                        {!hasMissingBillingData && hasMissingAttendeeData && (
                                            <p className="text-xs text-amber-600 text-center">
                                                Completa los datos de todos los asistentes, incluida la matricula cuando aplique
                                            </p>
                                        )}
                                        {!hasMissingBillingData && !hasMissingAttendeeData && hasMissingScheduleSelections && (
                                            <p className="text-xs text-amber-600 text-center">
                                                Completa los dias y turnos (si aplica) para todos los asistentes
                                            </p>
                                        )}

                                        <div className="text-xs text-gray-500 text-center mt-4">
                                            Pagos procesados de forma segura por IZIPAY
                                        </div>
                                    </>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            <AuthModal
                open={showAuthModal}
                onClose={() => setShowAuthModal(false)}
                onSuccess={handleAuthSuccess}
            />
        </div>
    )
}
