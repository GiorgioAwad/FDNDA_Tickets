"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useMerchCart } from "@/hooks/merch-cart-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { buildNaturalPersonFullName } from "@/lib/billing"
import { formatPrice } from "@/lib/utils"
import { getUbigeoNames } from "@/lib/ubigeo-peru"
import { formatMerchPickupAddress } from "@/lib/merch-pickup"
import { ZONE_THEME } from "@/components/merch/theme"
import type { IzipayCheckoutConfig } from "@/lib/izipay"
import {
    Trash2,
    Minus,
    Plus,
    CreditCard,
    Truck,
    MapPin,
    AlertCircle,
    ArrowLeft,
    FileText,
    User as UserIcon,
    Loader2,
} from "lucide-react"
import AuthModal from "@/components/auth/AuthModal"
import { UbigeoSelector } from "@/components/checkout/ubigeo-selector"

const IzipayCheckout = dynamic(
    () => import("@/components/checkout/izipay-checkout"),
    { ssr: false }
)

type DeliveryMethod = "SHIPPING_HOME" | "PICKUP_OFFICE"

interface PickupLocation {
    id: string
    name: string
    address: string
    district: string | null
    instructions: string | null
}

type PickupResolution =
    | { kind: "empty" }
    | { kind: "unavailable"; productIds: string[] }
    | { kind: "mixed"; pickupLocationIds: string[] }
    | { kind: "single"; pickupLocationId: string }

interface BillingState {
    documentType: "BOLETA" | "FACTURA"
    buyerDocNumber: string
    buyerFirstName: string
    buyerSecondName: string
    buyerLastNamePaternal: string
    buyerLastNameMaternal: string
    buyerName: string
    buyerAddress: string
    buyerEmail: string
    buyerPhone: string
    buyerUbigeo: string
}

const DEFAULT_BILLING: BillingState = {
    documentType: "BOLETA",
    buyerDocNumber: "",
    buyerFirstName: "",
    buyerSecondName: "",
    buyerLastNamePaternal: "",
    buyerLastNameMaternal: "",
    buyerName: "",
    buyerAddress: "",
    buyerEmail: "",
    buyerPhone: "",
    buyerUbigeo: "",
}

const MIN_MERCH_ORDER_SUBTOTAL = 30
const SHIPPING_COST_PROVINCE = Number(process.env.NEXT_PUBLIC_MERCH_SHIPPING_COST_PROV ?? "10")

function isLimaDestination(ubigeo: string | null | undefined): boolean {
    return Boolean(ubigeo?.startsWith("15"))
}

export default function MerchCheckoutPage() {
    const router = useRouter()
    const { data: session, status } = useSession()
    const { items, removeItem, updateQuantity, total: itemsTotal, clearCart } = useMerchCart()

    const paymentsMode =
        process.env.NEXT_PUBLIC_PAYMENTS_MODE ||
        (process.env.NODE_ENV === "production" ? "izipay" : "mock")

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [showAuthModal, setShowAuthModal] = useState(false)
    const [retryableOrder, setRetryableOrder] = useState<{
        id: string
        fingerprint: string
    } | null>(null)

    const [billing, setBilling] = useState<BillingState>(DEFAULT_BILLING)
    const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>("PICKUP_OFFICE")
    const [shippingAddress, setShippingAddress] = useState("")
    const [shippingDistrito, setShippingDistrito] = useState("")
    const [shippingReference, setShippingReference] = useState("")
    const [shippingPhone, setShippingPhone] = useState("")
    const [pickupLocations, setPickupLocations] = useState<PickupLocation[]>([])
    const [pickupResolution, setPickupResolution] = useState<PickupResolution>({ kind: "empty" })
    const [pickupLocationsLoading, setPickupLocationsLoading] = useState(true)
    const [pickupLocationsError, setPickupLocationsError] = useState("")
    // Usamos el ubigeo de facturación también para calcular costo de envío
    const shippingUbigeo = billing.buyerUbigeo

    const pickupProductIds = useMemo(
        () => Array.from(new Set(items.map((item) => item.productId))).sort().join(","),
        [items]
    )

    const loadPickupLocations = useCallback(async () => {
        if (!pickupProductIds) {
            setPickupLocations([])
            setPickupResolution({ kind: "empty" })
            setPickupLocationsError("")
            setPickupLocationsLoading(false)
            return
        }
        setPickupLocationsLoading(true)
        setPickupLocationsError("")
        try {
            const response = await fetch(
                `/api/merch/pickup-locations?productIds=${encodeURIComponent(pickupProductIds)}`,
                { cache: "no-store" }
            )
            const payload = await response.json()
            if (!response.ok || !payload.success) {
                throw new Error(payload.error || "No se pudieron cargar las sedes.")
            }

            const locations = payload.data as PickupLocation[]
            setPickupLocations(locations)
            setPickupResolution(payload.resolution as PickupResolution)
        } catch (loadError) {
            setPickupLocations([])
            setPickupResolution({ kind: "empty" })
            setPickupLocationsError((loadError as Error).message)
        } finally {
            setPickupLocationsLoading(false)
        }
    }, [pickupProductIds])

    const [izipayCheckoutData, setIzipayCheckoutData] = useState<{
        authorization: string
        keyRSA: string
        scriptUrl: string
        config: IzipayCheckoutConfig
        orderId: string
    } | null>(null)

    // Autofill email from session
    const emailAutofilledRef = useRef(false)
    useEffect(() => {
        if (emailAutofilledRef.current) return
        if (status !== "authenticated" || !session?.user?.email) return
        emailAutofilledRef.current = true
        setBilling((prev) => (prev.buyerEmail ? prev : { ...prev, buyerEmail: session.user.email ?? "" }))
    }, [status, session?.user?.email])

    useEffect(() => {
        void loadPickupLocations()
    }, [loadPickupLocations])

    // Auto-fill distrito desde ubigeo solo si está vacío (no pisa edición manual)
    useEffect(() => {
        if (!shippingUbigeo || shippingDistrito) return
        const names = getUbigeoNames(shippingUbigeo)
        if (names) setShippingDistrito(names.distrito)
    }, [shippingUbigeo, shippingDistrito])

    const destinationIsLima = useMemo(() => {
        if (!shippingUbigeo) return null
        return isLimaDestination(shippingUbigeo)
    }, [shippingUbigeo])

    useEffect(() => {
        if (destinationIsLima === null) return
        setDeliveryMethod(destinationIsLima ? "PICKUP_OFFICE" : "SHIPPING_HOME")
    }, [destinationIsLima])

    const shippingCost = useMemo(() => {
        if (deliveryMethod !== "SHIPPING_HOME") return 0
        return SHIPPING_COST_PROVINCE
    }, [deliveryMethod])

    const selectedPickupLocation = useMemo(
        () =>
            pickupResolution.kind === "single"
                ? pickupLocations.find((location) => location.id === pickupResolution.pickupLocationId) ?? null
                : null,
        [pickupResolution, pickupLocations]
    )
    const canPickup =
        !pickupLocationsLoading &&
        !pickupLocationsError &&
        pickupResolution.kind === "single" &&
        selectedPickupLocation !== null

    useEffect(() => {
        if (
            destinationIsLima === false &&
            deliveryMethod === "PICKUP_OFFICE" &&
            !pickupLocationsLoading &&
            !canPickup
        ) {
            setDeliveryMethod("SHIPPING_HOME")
        }
    }, [canPickup, deliveryMethod, destinationIsLima, pickupLocationsLoading])

    const grandTotal = itemsTotal + shippingCost
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)
    const minimumRemaining = Math.max(MIN_MERCH_ORDER_SUBTOTAL - itemsTotal, 0)

    const boletaFullName = useMemo(
        () =>
            buildNaturalPersonFullName({
                firstName: billing.buyerFirstName,
                secondName: billing.buyerSecondName,
                lastNamePaternal: billing.buyerLastNamePaternal,
                lastNameMaternal: billing.buyerLastNameMaternal,
            }),
        [billing.buyerFirstName, billing.buyerSecondName, billing.buyerLastNamePaternal, billing.buyerLastNameMaternal]
    )

    const validate = useCallback((): string | null => {
        if (items.length === 0) return "Tu carrito está vacío"
        if (itemsTotal < MIN_MERCH_ORDER_SUBTOTAL) return `La compra minima de merch es de ${formatPrice(MIN_MERCH_ORDER_SUBTOTAL)}.`
        if (!billing.buyerEmail || !/\S+@\S+\.\S+/.test(billing.buyerEmail)) return "Email inválido"
        if (!billing.buyerPhone || billing.buyerPhone.length < 6) return "Teléfono requerido"

        if (billing.documentType === "BOLETA") {
            if (!billing.buyerDocNumber || billing.buyerDocNumber.length < 8) return "DNI inválido"
            if (!billing.buyerFirstName.trim() || !billing.buyerLastNamePaternal.trim()) {
                return "Completa nombres y apellidos para la boleta"
            }
        } else {
            if (!billing.buyerDocNumber || billing.buyerDocNumber.length !== 11) return "RUC debe tener 11 dígitos"
            if (!billing.buyerName.trim()) return "Razón social requerida"
            if (!billing.buyerAddress.trim()) return "Dirección fiscal requerida (factura)"
        }
        if (!billing.buyerUbigeo) return "Selecciona tu ubicación (departamento/provincia/distrito)"

        if (deliveryMethod === "SHIPPING_HOME") {
            if (destinationIsLima) return "El envio a domicilio esta disponible solo para provincia. Elige una sede de recojo."
            if (!shippingAddress.trim()) return "Dirección de envío requerida"
            if (!shippingDistrito.trim()) return "Distrito requerido"
            if (!shippingPhone.trim()) return "Teléfono de contacto para envío requerido"
        } else if (pickupLocationsLoading) {
            return "Espera mientras confirmamos la sede asignada a tus productos."
        } else if (pickupLocationsError) {
            return pickupLocationsError
        } else if (pickupResolution.kind === "mixed") {
            return "Tu carrito contiene productos de sedes distintas. Para recojo, cómpralos en pedidos separados."
        } else if (pickupResolution.kind === "unavailable" || !selectedPickupLocation) {
            return "Uno o más productos no tiene una sede de recojo activa. Actualiza tu carrito o elige envío."
        }
        return null
    }, [items.length, itemsTotal, billing, destinationIsLima, deliveryMethod, selectedPickupLocation, pickupLocationsError, pickupLocationsLoading, pickupResolution, shippingAddress, shippingDistrito, shippingPhone])

    const handleCheckout = async (e: React.FormEvent) => {
        e.preventDefault()

        if (status === "unauthenticated") {
            setShowAuthModal(true)
            return
        }

        const validationError = validate()
        if (validationError) {
            setError(validationError)
            return
        }

        setLoading(true)
        setError("")

        try {
            const orderPayload = {
                items: items.map((item) => ({
                    productId: item.productId,
                    variantId: item.variantId,
                    quantity: item.quantity,
                })),
                billing: {
                    ...billing,
                    buyerName: billing.documentType === "BOLETA" ? boletaFullName : billing.buyerName,
                },
                delivery:
                    deliveryMethod === "SHIPPING_HOME"
                        ? {
                                method: "SHIPPING_HOME" as const,
                                shippingAddress,
                                shippingDistrito,
                                shippingUbigeo,
                                shippingReference: shippingReference || null,
                                shippingPhone,
                            }
                        : {
                                method: "PICKUP_OFFICE" as const,
                            },
            }
            const orderFingerprint = JSON.stringify(orderPayload)
            const canReuseOrder =
                paymentsMode === "izipay" &&
                retryableOrder?.fingerprint === orderFingerprint

            const createOrder = async () => {
                const orderResponse = await fetch("/api/merch/orders", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: orderFingerprint,
                })
                const orderData = await orderResponse.json()
                if (!orderResponse.ok || !orderData.success) {
                    throw new Error(orderData.error || "Error al crear la orden")
                }

                const orderId = orderData.data.orderId as string
                setRetryableOrder({ id: orderId, fingerprint: orderFingerprint })
                return orderId
            }

            let orderId = canReuseOrder ? retryableOrder.id : await createOrder()

            // Mock payment for dev
            if (paymentsMode === "mock") {
                const mockResponse = await fetch("/api/payments/mock", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ orderId, action: "approve" }),
                })
                const mockData = await mockResponse.json()
                if (!mockResponse.ok || !mockData.success) {
                    throw new Error(mockData.error || "Error en pago mock")
                }
                clearCart()
                setRetryableOrder(null)
                router.push(`/checkout/success?orderId=${orderId}`)
                return
            }

            // OpenPay
            if (paymentsMode === "openpay") {
                const openpayResponse = await fetch("/api/payments/openpay/charge", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ orderId }),
                })
                const openpayData = await openpayResponse.json()
                if (!openpayResponse.ok || !openpayData.success) {
                    throw new Error(openpayData.error || "Error con OpenPay")
                }
                if (openpayData.data?.alreadyPaid) {
                    clearCart()
                    setRetryableOrder(null)
                    router.push(`/checkout/success?orderId=${orderId}`)
                    return
                }
                clearCart()
                setRetryableOrder(null)
                window.location.assign(openpayData.data.paymentUrl)
                return
            }

            // Izipay
            const createSession = async (targetOrderId: string) => {
                const response = await fetch("/api/payments/izipay/session", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ orderId: targetOrderId }),
                })
                return { response, data: await response.json() }
            }

            let sessionResult = await createSession(orderId)
            if (
                canReuseOrder &&
                sessionResult.response.status === 400 &&
                sessionResult.data.code === "ORDER_NOT_PAYABLE"
            ) {
                orderId = await createOrder()
                sessionResult = await createSession(orderId)
            }

            const { response: sessionResponse, data: sessionData } = sessionResult
            if (!sessionResponse.ok || !sessionData.success) {
                throw new Error(sessionData.error || "No se pudo iniciar IZIPAY")
            }
            if (sessionData.data?.alreadyPaid) {
                clearCart()
                setRetryableOrder(null)
                router.push(`/checkout/success?orderId=${orderId}`)
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
                    orderId,
                })
                return
            }
            throw new Error("IZIPAY no devolvió datos suficientes")
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }

    if (items.length === 0 && !izipayCheckoutData) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
                <div className="container mx-auto px-4 py-16 sm:py-24 text-center">
                    <h1 className="font-display text-3xl font-bold mb-2">Tu carrito de merch está vacío</h1>
                    <p className="text-muted-foreground mb-6">Agrega algún producto y vuelve a esta pantalla.</p>
                    <Button onClick={() => router.push("/merch")} variant="coral">Ver merch</Button>
                </div>
            </div>
        )
    }

    if (izipayCheckoutData) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
                <div className="container mx-auto px-4 py-10">
                    <h1 className="font-display text-2xl font-bold mb-4">Procesando pago…</h1>
                    <IzipayCheckout
                        authorization={izipayCheckoutData.authorization}
                        keyRSA={izipayCheckoutData.keyRSA}
                        scriptUrl={izipayCheckoutData.scriptUrl}
                        config={izipayCheckoutData.config}
                        orderId={izipayCheckoutData.orderId}
                        onSuccess={() => {
                            setRetryableOrder(null)
                            clearCart()
                            router.push(`/checkout/success?orderId=${izipayCheckoutData.orderId}`)
                        }}
                        onError={(err) => {
                            setError(err)
                            // Sin esto el error queda invisible: esta vista no
                            // renderiza el banner y el comprador no puede reintentar.
                            setIzipayCheckoutData(null)
                        }}
                    />
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
            <AuthModal
                open={showAuthModal}
                onClose={() => setShowAuthModal(false)}
                onSuccess={() => setShowAuthModal(false)}
            />
            <div className="container mx-auto px-4 py-8 max-w-6xl">
                <button
                    type="button"
                    onClick={() => router.push("/merch")}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Volver a merch
                </button>
                <h1 className="font-display text-3xl sm:text-4xl font-bold mb-6">Confirmar tu pedido</h1>

                {error && (
                    <div className="mb-4 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700 inline-flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </div>
                )}

                <form onSubmit={handleCheckout} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                        {/* Productos */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Tu pedido</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {items.map((item) => {
                                    const theme = ZONE_THEME[item.zone]
                                    return (
                                        <div key={item.lineKey} className="flex gap-3 p-3 rounded-xl bg-gray-50 border border-border">
                                            <div className={`relative h-16 w-16 rounded-lg overflow-hidden flex-shrink-0 ${theme.bg}`}>
                                                {item.imageUrl && (
                                                    <Image src={item.imageUrl} alt={item.productName} fill sizes="64px" className="object-contain p-1" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-semibold text-foreground line-clamp-1">{item.productName}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {item.zone !== "GENERICA" && <span>Zona {theme.short}</span>}
                                                    {item.size && <span> · Talla {item.size}</span>}
                                                </div>
                                                <div className="flex items-center justify-between mt-2">
                                                    <div className="inline-flex items-center rounded-full border border-border overflow-hidden bg-white">
                                                        <button type="button" className="h-8 w-8 inline-flex items-center justify-center hover:bg-gray-50"
                                                            onClick={() => updateQuantity(item.lineKey, item.quantity - 1)} aria-label="Disminuir">
                                                            <Minus className="h-3 w-3" />
                                                        </button>
                                                        <span className="px-3 text-sm font-semibold">{item.quantity}</span>
                                                        <button type="button" className="h-8 w-8 inline-flex items-center justify-center hover:bg-gray-50"
                                                            onClick={() => updateQuantity(item.lineKey, item.quantity + 1)} aria-label="Aumentar">
                                                            <Plus className="h-3 w-3" />
                                                        </button>
                                                    </div>
                                                    <div className="font-bold text-fdnda-primary">{formatPrice(item.price * item.quantity)}</div>
                                                </div>
                                            </div>
                                            <button type="button" className="text-muted-foreground hover:text-destructive p-1"
                                                onClick={() => removeItem(item.lineKey)} aria-label="Quitar">
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    )
                                })}
                                {minimumRemaining > 0 && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                        La compra minima de merch es de {formatPrice(MIN_MERCH_ORDER_SUBTOTAL)}. Agrega {formatPrice(minimumRemaining)} mas en productos.
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Entrega */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Truck className="h-5 w-5 text-fdnda-secondary" />
                                    ¿Cómo quieres recibirlo?
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="rounded-lg border border-fdnda-primary/20 bg-fdnda-primary/5 p-3 text-sm text-foreground">
                                    El recojo en sede no tiene costo. Para provincia también puedes elegir envío a domicilio por S/ {SHIPPING_COST_PROVINCE}.
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setDeliveryMethod("SHIPPING_HOME")}
                                        disabled={destinationIsLima === true}
                                        className={`p-4 rounded-xl border-2 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                            deliveryMethod === "SHIPPING_HOME"
                                                ? "border-fdnda-primary bg-fdnda-primary/5"
                                                : "border-border bg-white hover:border-fdnda-primary/50"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <Truck className="h-4 w-4 text-fdnda-primary" />
                                            <span className="font-semibold text-sm">Envío a domicilio</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">Solo provincia · S/ {SHIPPING_COST_PROVINCE}</p>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setDeliveryMethod("PICKUP_OFFICE")}
                                        disabled={!canPickup}
                                        className={`p-4 rounded-xl border-2 text-left transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                                            deliveryMethod === "PICKUP_OFFICE"
                                                ? "border-fdnda-primary bg-fdnda-primary/5"
                                                : "border-border bg-white hover:border-fdnda-primary/50"
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <MapPin className="h-4 w-4 text-fdnda-primary" />
                                            <span className="font-semibold text-sm">Recojo en sede</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {pickupLocationsLoading
                                                ? "Confirmando sede asignada..."
                                                : pickupResolution.kind === "single" && selectedPickupLocation
                                                    ? `${selectedPickupLocation.name} · Sin costo`
                                                    : pickupResolution.kind === "mixed"
                                                        ? `${pickupLocations.length} sedes distintas · Compra por separado`
                                                        : "Recojo no disponible para este carrito"}
                                        </p>
                                    </button>
                                </div>

                                {deliveryMethod === "PICKUP_OFFICE" && (
                                    <div className="space-y-2" aria-live="polite">
                                        <p className="text-sm font-semibold text-foreground">
                                            Sede asignada a tus productos
                                        </p>
                                        {pickupLocationsLoading ? (
                                            <div className="flex items-center gap-2 rounded-xl border border-border bg-gray-50 p-4 text-sm text-muted-foreground">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Confirmando dónde recogerás tu pedido...
                                            </div>
                                        ) : pickupLocationsError ? (
                                            <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                                                <p className="text-sm text-red-700">{pickupLocationsError}</p>
                                                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={loadPickupLocations}>
                                                    Volver a intentar
                                                </Button>
                                            </div>
                                        ) : pickupResolution.kind === "mixed" ? (
                                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                                                <p className="font-semibold">Este carrito combina productos de sedes distintas.</p>
                                                <p className="mt-1">
                                                    Para recogerlos, realiza un pedido separado por cada sede.
                                                </p>
                                                <ul className="mt-3 space-y-1">
                                                    {pickupLocations.map((location) => (
                                                        <li key={location.id} className="flex items-start gap-2">
                                                            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                                            <span className="break-words">{location.name} · {formatMerchPickupAddress(location)}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ) : pickupResolution.kind === "unavailable" || !selectedPickupLocation ? (
                                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                                                Uno o más productos no tiene una sede de recojo activa. Retíralo del carrito o elige envío a provincia.
                                            </div>
                                        ) : (
                                            <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
                                                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-semibold break-words">{selectedPickupLocation.name}</p>
                                                    <p className="mt-0.5 text-sm break-words opacity-80">
                                                        {formatMerchPickupAddress(selectedPickupLocation)}
                                                    </p>
                                                    {selectedPickupLocation.instructions && (
                                                        <p className="mt-1 text-xs break-words opacity-75">
                                                            {selectedPickupLocation.instructions}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {deliveryMethod === "SHIPPING_HOME" && (
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-sm font-semibold block mb-1.5">Dirección de envío *</label>
                                            <Input
                                                value={shippingAddress}
                                                onChange={(e) => setShippingAddress(e.target.value)}
                                                placeholder="Av. Ejemplo 123, Dpto 401"
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <div>
                                                <label className="text-sm font-semibold block mb-1.5">Distrito *</label>
                                                <Input
                                                    value={shippingDistrito}
                                                    onChange={(e) => setShippingDistrito(e.target.value)}
                                                    placeholder="Miraflores"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-sm font-semibold block mb-1.5">Teléfono de contacto *</label>
                                                <Input
                                                    value={shippingPhone}
                                                    onChange={(e) => setShippingPhone(e.target.value)}
                                                    placeholder="9XXXXXXXX"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-sm font-semibold block mb-1.5">Referencia (opcional)</label>
                                            <Input
                                                value={shippingReference}
                                                onChange={(e) => setShippingReference(e.target.value)}
                                                placeholder="Frente al parque, edificio azul"
                                            />
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Datos del comprador / facturación */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-fdnda-secondary" />
                                    Datos para tu comprobante
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setBilling({ ...billing, documentType: "BOLETA", buyerDocNumber: "", buyerName: "", buyerAddress: "" })}
                                        className={`flex-1 h-10 rounded-lg border-2 text-sm font-semibold ${
                                            billing.documentType === "BOLETA"
                                                ? "border-fdnda-primary bg-fdnda-primary/5 text-fdnda-primary"
                                                : "border-border text-foreground"
                                        }`}
                                    >
                                        Boleta (DNI)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setBilling({ ...billing, documentType: "FACTURA", buyerDocNumber: "", buyerName: "", buyerAddress: "" })}
                                        className={`flex-1 h-10 rounded-lg border-2 text-sm font-semibold ${
                                            billing.documentType === "FACTURA"
                                                ? "border-fdnda-primary bg-fdnda-primary/5 text-fdnda-primary"
                                                : "border-border text-foreground"
                                        }`}
                                    >
                                        Factura (RUC)
                                    </button>
                                </div>

                                {billing.documentType === "BOLETA" ? (
                                    <>
                                        <div>
                                            <label className="text-sm font-semibold block mb-1.5">DNI *</label>
                                            <Input
                                                value={billing.buyerDocNumber}
                                                onChange={(e) => setBilling({ ...billing, buyerDocNumber: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                                                placeholder="12345678"
                                                inputMode="numeric"
                                                maxLength={8}
                                            />
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <Input value={billing.buyerFirstName} onChange={(e) => setBilling({ ...billing, buyerFirstName: e.target.value })} placeholder="Primer nombre *" />
                                            <Input value={billing.buyerSecondName} onChange={(e) => setBilling({ ...billing, buyerSecondName: e.target.value })} placeholder="Segundo nombre" />
                                            <Input value={billing.buyerLastNamePaternal} onChange={(e) => setBilling({ ...billing, buyerLastNamePaternal: e.target.value })} placeholder="Apellido paterno *" />
                                            <Input value={billing.buyerLastNameMaternal} onChange={(e) => setBilling({ ...billing, buyerLastNameMaternal: e.target.value })} placeholder="Apellido materno" />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div>
                                            <label className="text-sm font-semibold block mb-1.5">RUC *</label>
                                            <Input
                                                value={billing.buyerDocNumber}
                                                onChange={(e) => setBilling({ ...billing, buyerDocNumber: e.target.value.replace(/\D/g, "").slice(0, 11) })}
                                                placeholder="20XXXXXXXXX"
                                                inputMode="numeric"
                                                maxLength={11}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-sm font-semibold block mb-1.5">Razón social *</label>
                                            <Input value={billing.buyerName} onChange={(e) => setBilling({ ...billing, buyerName: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="text-sm font-semibold block mb-1.5">Dirección fiscal *</label>
                                            <Input value={billing.buyerAddress} onChange={(e) => setBilling({ ...billing, buyerAddress: e.target.value })} />
                                        </div>
                                    </>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <Input type="email" value={billing.buyerEmail} onChange={(e) => setBilling({ ...billing, buyerEmail: e.target.value })} placeholder="email *" />
                                    <Input value={billing.buyerPhone} onChange={(e) => setBilling({ ...billing, buyerPhone: e.target.value })} placeholder="Teléfono *" />
                                </div>

                                <div>
                                    <label className="text-sm font-semibold block mb-1.5">Ubicación *</label>
                                    <UbigeoSelector value={billing.buyerUbigeo} onChange={(ubigeo) => setBilling({ ...billing, buyerUbigeo: ubigeo })} />
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Resumen */}
                    <div className="lg:col-span-1">
                        <div className="sticky top-20 space-y-4">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Resumen</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">Productos ({itemCount})</span>
                                        <span>{formatPrice(itemsTotal)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-muted-foreground">{deliveryMethod === "SHIPPING_HOME" ? "Envio" : "Recojo"}</span>
                                        <span>{shippingCost > 0 ? formatPrice(shippingCost) : "Gratis"}</span>
                                    </div>
                                    <div className="h-px bg-border my-2" />
                                    <div className="flex justify-between text-base font-bold">
                                        <span>Total</span>
                                        <span className="text-fdnda-primary">{formatPrice(grandTotal)}</span>
                                    </div>
                                    {status === "unauthenticated" ? (
                                        <Button type="button" variant="coral" className="w-full mt-3" onClick={() => setShowAuthModal(true)}>
                                            <UserIcon className="h-4 w-4" />
                                            Inicia sesión para pagar
                                        </Button>
                                    ) : (
                                        <Button type="submit" variant="coral" className="w-full mt-3" loading={loading}>
                                            <CreditCard className="h-4 w-4" />
                                            Pagar {formatPrice(grandTotal)}
                                        </Button>
                                    )}
                                    <p className="text-[11px] text-muted-foreground text-center mt-2">
                                        Pago seguro con Izipay · Boleta o factura electrónica
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    )
}
