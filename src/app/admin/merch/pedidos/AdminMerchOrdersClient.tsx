"use client"

import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/empty-state"
import { formatPrice } from "@/lib/utils"
import { Loader2, Package, RefreshCw, Search, Truck, MapPin, Phone, Mail } from "lucide-react"

type FulfillmentStatus = "PENDING" | "READY" | "SHIPPED" | "DELIVERED" | "PICKED_UP" | "CANCELLED"
type DeliveryMethod = "PICKUP_EVENT" | "SHIPPING_HOME" | "PICKUP_OFFICE"
type PaymentStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"

export interface AdminMerchOrder {
    id: string
    status: PaymentStatus
    totalAmount: number
    shippingCost: number
    deliveryMethod: DeliveryMethod | null
    shippingAddress: string | null
    shippingDistrito: string | null
    shippingUbigeo: string | null
    shippingPhone: string | null
    fulfillmentStatus: FulfillmentStatus | null
    fulfilledAt: string | null
    trackingCode: string | null
    paidAt: string | null
    createdAt: string
    buyerName: string | null
    buyerDocNumber: string | null
    buyerPhone: string | null
    user: { id: string; name: string; email: string }
    orderItems: Array<{
        id: string
        quantity: number
        unitPrice: number
        merchSnapshot: Record<string, unknown> | null
        merchVariant: {
            size: string | null
            sku: string | null
            product: { name: string; category: string; zone: string }
        } | null
    }>
}

const FULFILLMENT_OPTIONS: Array<{ value: FulfillmentStatus; label: string }> = [
    { value: "PENDING", label: "Pendiente" },
    { value: "READY", label: "Listo" },
    { value: "SHIPPED", label: "Enviado" },
    { value: "DELIVERED", label: "Entregado" },
    { value: "PICKED_UP", label: "Recogido" },
    { value: "CANCELLED", label: "Cancelado" },
]

const FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = Object.fromEntries(
    FULFILLMENT_OPTIONS.map((o) => [o.value, o.label])
) as Record<FulfillmentStatus, string>

const FULFILLMENT_BADGE: Record<FulfillmentStatus, string> = {
    PENDING: "bg-amber-100 text-amber-800 border-amber-200",
    READY: "bg-sky-100 text-sky-800 border-sky-200",
    SHIPPED: "bg-indigo-100 text-indigo-800 border-indigo-200",
    DELIVERED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    PICKED_UP: "bg-emerald-100 text-emerald-800 border-emerald-200",
    CANCELLED: "bg-rose-100 text-rose-800 border-rose-200",
}

const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
    PICKUP_EVENT: "Recojo en evento",
    SHIPPING_HOME: "Envío a domicilio",
    PICKUP_OFFICE: "Recojo en sede",
}

function formatDate(value: string | null): string {
    if (!value) return "—"
    return new Date(value).toLocaleString("es-PE", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

function shortId(id: string): string {
    return id.slice(-8).toUpperCase()
}

interface RowState {
    fulfillmentStatus: FulfillmentStatus
    trackingCode: string
    saving: boolean
    expanded: boolean
}

function buildInitialRowState(order: AdminMerchOrder): RowState {
    return {
        fulfillmentStatus: order.fulfillmentStatus || "PENDING",
        trackingCode: order.trackingCode || "",
        saving: false,
        expanded: false,
    }
}

interface AdminMerchOrdersClientProps {
    initialOrders: AdminMerchOrder[]
}

export default function AdminMerchOrdersClient({ initialOrders }: AdminMerchOrdersClientProps) {
    const [orders, setOrders] = useState<AdminMerchOrder[]>(initialOrders)
    const [rowState, setRowState] = useState<Record<string, RowState>>(() =>
        Object.fromEntries(initialOrders.map((o) => [o.id, buildInitialRowState(o)]))
    )
    const [fulfillmentFilter, setFulfillmentFilter] = useState<FulfillmentStatus | "ALL">("ALL")
    const [deliveryFilter, setDeliveryFilter] = useState<DeliveryMethod | "ALL">("ALL")
    const [search, setSearch] = useState("")
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        setRowState((prev) => {
            const next: Record<string, RowState> = {}
            for (const order of orders) {
                next[order.id] = prev[order.id] || buildInitialRowState(order)
            }
            return next
        })
    }, [orders])

    async function refresh() {
        setLoading(true)
        try {
            const params = new URLSearchParams()
            if (fulfillmentFilter !== "ALL") params.set("fulfillment", fulfillmentFilter)
            if (deliveryFilter !== "ALL") params.set("delivery", deliveryFilter)
            if (search.trim()) params.set("q", search.trim())
            const res = await fetch(`/api/admin/merch/orders?${params.toString()}`, { cache: "no-store" })
            const json = await res.json()
            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al cargar pedidos")
            }
            setOrders(json.data as AdminMerchOrder[])
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            setLoading(false)
        }
    }

    const counts = useMemo(() => {
        const acc = { total: orders.length, pending: 0, ready: 0, shipped: 0, done: 0 }
        for (const order of orders) {
            const s = order.fulfillmentStatus || "PENDING"
            if (s === "PENDING") acc.pending++
            else if (s === "READY") acc.ready++
            else if (s === "SHIPPED") acc.shipped++
            else if (s === "DELIVERED" || s === "PICKED_UP") acc.done++
        }
        return acc
    }, [orders])

    function updateRow(id: string, patch: Partial<RowState>) {
        setRowState((prev) => ({
            ...prev,
            [id]: { ...prev[id], ...patch },
        }))
    }

    async function saveRow(order: AdminMerchOrder) {
        const row = rowState[order.id]
        if (!row) return
        if (row.fulfillmentStatus === "SHIPPED" && !row.trackingCode.trim()) {
            toast.error("Para marcar como enviado necesitas un código de tracking")
            return
        }
        updateRow(order.id, { saving: true })
        try {
            const res = await fetch(`/api/admin/merch/orders/${order.id}/fulfillment`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fulfillmentStatus: row.fulfillmentStatus,
                    trackingCode: row.trackingCode.trim() || null,
                }),
            })
            const json = await res.json()
            if (!res.ok || !json.success) {
                throw new Error(json.error || "Error al actualizar")
            }
            const { statusChanged, emailSent, emailError } = json.data
            if (statusChanged && emailSent) {
                toast.success("Estado actualizado y correo enviado")
            } else if (statusChanged && emailError) {
                toast.warning(`Estado actualizado, pero el correo falló: ${emailError}`)
            } else if (statusChanged) {
                toast.success("Estado actualizado")
            } else {
                toast.success("Pedido guardado")
            }
            setOrders((prev) =>
                prev.map((o) =>
                    o.id === order.id
                        ? {
                              ...o,
                              fulfillmentStatus: json.data.order.fulfillmentStatus,
                              fulfilledAt: json.data.order.fulfilledAt
                                  ? new Date(json.data.order.fulfilledAt).toISOString()
                                  : null,
                              trackingCode: json.data.order.trackingCode,
                          }
                        : o
                )
            )
        } catch (error) {
            toast.error((error as Error).message)
        } finally {
            updateRow(order.id, { saving: false })
        }
    }

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="font-display text-3xl font-bold text-foreground">Pedidos de merch</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Actualiza el estado de cada pedido pagado y notifica al comprador.
                    </p>
                </div>
                <Button variant="outline" onClick={refresh} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Recargar
                </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-border p-4">
                    <div className="text-xs uppercase text-muted-foreground font-semibold">Total</div>
                    <div className="text-2xl font-display font-bold text-foreground mt-1">{counts.total}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                    <div className="text-xs uppercase text-muted-foreground font-semibold">Pendientes</div>
                    <div className="text-2xl font-display font-bold text-amber-600 mt-1">{counts.pending}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                    <div className="text-xs uppercase text-muted-foreground font-semibold">Enviados</div>
                    <div className="text-2xl font-display font-bold text-indigo-600 mt-1">{counts.shipped}</div>
                </div>
                <div className="bg-white rounded-xl border border-border p-4">
                    <div className="text-xs uppercase text-muted-foreground font-semibold">Completados</div>
                    <div className="text-2xl font-display font-bold text-emerald-600 mt-1">{counts.done}</div>
                </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-end gap-3">
                <div className="flex-1">
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Buscar</label>
                    <div className="relative mt-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && refresh()}
                            placeholder="Orden, email, nombre, DNI/RUC, tracking..."
                            className="pl-9"
                        />
                    </div>
                </div>
                <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Estado</label>
                    <select
                        value={fulfillmentFilter}
                        onChange={(e) => setFulfillmentFilter(e.target.value as FulfillmentStatus | "ALL")}
                        className="mt-1 block w-full md:w-44 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        <option value="ALL">Todos</option>
                        {FULFILLMENT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                                {o.label}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase">Entrega</label>
                    <select
                        value={deliveryFilter}
                        onChange={(e) => setDeliveryFilter(e.target.value as DeliveryMethod | "ALL")}
                        className="mt-1 block w-full md:w-48 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        <option value="ALL">Todas</option>
                        <option value="SHIPPING_HOME">Envío a domicilio</option>
                        <option value="PICKUP_OFFICE">Recojo en sede</option>
                        <option value="PICKUP_EVENT">Recojo en evento</option>
                    </select>
                </div>
                <Button onClick={refresh} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Aplicar
                </Button>
            </div>

            {orders.length === 0 ? (
                <EmptyState
                    variant="generic"
                    title="No hay pedidos"
                    description="Cuando los usuarios paguen merch, aparecerán aquí."
                />
            ) : (
                <div className="space-y-3">
                    {orders.map((order) => {
                        const row = rowState[order.id]
                        if (!row) return null
                        const fulfillment = order.fulfillmentStatus || "PENDING"
                        const needsTracking = row.fulfillmentStatus === "SHIPPED"
                        const isShipping = order.deliveryMethod === "SHIPPING_HOME"

                        return (
                            <div
                                key={order.id}
                                className="bg-white rounded-xl border border-border p-4 space-y-3"
                            >
                                <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="font-mono text-sm font-semibold text-foreground">
                                                #{shortId(order.id)}
                                            </span>
                                            <Badge className={FULFILLMENT_BADGE[fulfillment]} variant="outline">
                                                {FULFILLMENT_LABEL[fulfillment]}
                                            </Badge>
                                            {order.deliveryMethod && (
                                                <Badge variant="outline" className="font-medium">
                                                    {isShipping ? (
                                                        <Truck className="h-3 w-3 mr-1" />
                                                    ) : (
                                                        <MapPin className="h-3 w-3 mr-1" />
                                                    )}
                                                    {DELIVERY_LABEL[order.deliveryMethod]}
                                                </Badge>
                                            )}
                                        </div>
                                        <div className="text-sm text-foreground mt-1">
                                            {order.buyerName || order.user.name}{" "}
                                            <span className="text-muted-foreground">· {order.user.email}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground mt-0.5">
                                            Pagado: {formatDate(order.paidAt)} · {formatPrice(order.totalAmount)}
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row gap-2 lg:items-end">
                                        <div>
                                            <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                                                Nuevo estado
                                            </label>
                                            <select
                                                value={row.fulfillmentStatus}
                                                onChange={(e) =>
                                                    updateRow(order.id, {
                                                        fulfillmentStatus: e.target.value as FulfillmentStatus,
                                                    })
                                                }
                                                className="mt-1 block w-full sm:w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                disabled={row.saving}
                                            >
                                                {FULFILLMENT_OPTIONS.map((o) => (
                                                    <option key={o.value} value={o.value}>
                                                        {o.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-semibold text-muted-foreground uppercase">
                                                Tracking{needsTracking ? " *" : ""}
                                            </label>
                                            <Input
                                                value={row.trackingCode}
                                                onChange={(e) =>
                                                    updateRow(order.id, { trackingCode: e.target.value })
                                                }
                                                placeholder="Cód. courier"
                                                className="mt-1 w-full sm:w-44"
                                                disabled={row.saving}
                                            />
                                        </div>
                                        <Button
                                            onClick={() => saveRow(order)}
                                            disabled={row.saving}
                                            className="sm:self-end"
                                        >
                                            {row.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Guardar"}
                                        </Button>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => updateRow(order.id, { expanded: !row.expanded })}
                                    className="text-xs font-semibold text-fdnda-secondary hover:underline"
                                >
                                    {row.expanded ? "Ocultar detalle" : "Ver detalle"}
                                </button>

                                {row.expanded && (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-border">
                                        <div>
                                            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-1">
                                                <Package className="h-3 w-3" /> Productos
                                            </h4>
                                            <ul className="space-y-2 text-sm">
                                                {order.orderItems.map((item) => {
                                                    const snap = item.merchSnapshot || {}
                                                    const name =
                                                        (typeof snap.productName === "string" && snap.productName) ||
                                                        item.merchVariant?.product.name ||
                                                        "Producto"
                                                    const size =
                                                        (typeof snap.size === "string" && snap.size) ||
                                                        item.merchVariant?.size
                                                    const sku =
                                                        (typeof snap.sku === "string" && snap.sku) ||
                                                        item.merchVariant?.sku
                                                    return (
                                                        <li key={item.id} className="flex justify-between gap-2">
                                                            <div>
                                                                <div className="font-medium text-foreground">
                                                                    {item.quantity}× {name}
                                                                </div>
                                                                <div className="text-xs text-muted-foreground">
                                                                    {size ? `Talla ${size}` : ""}
                                                                    {sku ? ` · SKU ${sku}` : ""}
                                                                </div>
                                                            </div>
                                                            <div className="text-sm font-medium text-foreground">
                                                                {formatPrice(item.unitPrice * item.quantity)}
                                                            </div>
                                                        </li>
                                                    )
                                                })}
                                            </ul>
                                        </div>
                                        <div className="space-y-2 text-sm">
                                            <h4 className="text-xs font-bold uppercase text-muted-foreground mb-2">
                                                Entrega y contacto
                                            </h4>
                                            {order.deliveryMethod === "SHIPPING_HOME" ? (
                                                <>
                                                    <div className="flex items-start gap-2">
                                                        <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                                                        <span>
                                                            {order.shippingAddress}
                                                            {order.shippingDistrito ? `, ${order.shippingDistrito}` : ""}
                                                        </span>
                                                    </div>
                                                    {order.shippingPhone && (
                                                        <div className="flex items-center gap-2">
                                                            <Phone className="h-4 w-4 text-muted-foreground" />
                                                            <span>{order.shippingPhone}</span>
                                                        </div>
                                                    )}
                                                    {order.shippingCost > 0 && (
                                                        <div className="text-xs text-muted-foreground">
                                                            Envío: {formatPrice(order.shippingCost)}
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                <div className="text-muted-foreground">
                                                    Recojo en sede Campo de Marte
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 text-muted-foreground">
                                                <Mail className="h-4 w-4" />
                                                <span>{order.user.email}</span>
                                            </div>
                                            {order.buyerDocNumber && (
                                                <div className="text-xs text-muted-foreground">
                                                    Documento: {order.buyerDocNumber}
                                                </div>
                                            )}
                                            {order.trackingCode && (
                                                <div className="text-xs">
                                                    <span className="font-semibold">Tracking actual:</span>{" "}
                                                    {order.trackingCode}
                                                </div>
                                            )}
                                            {order.fulfilledAt && (
                                                <div className="text-xs text-muted-foreground">
                                                    Completado: {formatDate(order.fulfilledAt)}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
