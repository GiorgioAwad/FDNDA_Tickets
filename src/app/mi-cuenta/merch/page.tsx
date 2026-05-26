import { redirect } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { formatPrice } from "@/lib/utils"
import { ArrowLeft, ShoppingBag, Package, MapPin, Truck, Clock, CheckCircle2, XCircle, Mail } from "lucide-react"

export const dynamic = "force-dynamic"

type FulfillmentStatus = "PENDING" | "READY" | "SHIPPED" | "DELIVERED" | "PICKED_UP" | "CANCELLED"
type DeliveryMethod = "PICKUP_EVENT" | "SHIPPING_HOME" | "PICKUP_OFFICE"

const FULFILLMENT_BADGE: Record<FulfillmentStatus, { label: string; className: string }> = {
    PENDING: { label: "Pendiente", className: "bg-amber-100 text-amber-800 border-amber-200" },
    READY: { label: "Listo para entrega", className: "bg-sky-100 text-sky-800 border-sky-200" },
    SHIPPED: { label: "Enviado", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
    DELIVERED: { label: "Entregado", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    PICKED_UP: { label: "Recogido", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    CANCELLED: { label: "Cancelado", className: "bg-rose-100 text-rose-800 border-rose-200" },
}

const PAYMENT_BADGE: Record<string, { label: string; className: string }> = {
    PAID: { label: "Pagado", className: "bg-emerald-100 text-emerald-800 border-emerald-200" },
    PENDING: { label: "Pago pendiente", className: "bg-amber-100 text-amber-800 border-amber-200" },
    CANCELLED: { label: "Cancelado", className: "bg-rose-100 text-rose-800 border-rose-200" },
    REFUNDED: { label: "Reembolsado", className: "bg-slate-100 text-slate-800 border-slate-200" },
}

const DELIVERY_LABEL: Record<DeliveryMethod, string> = {
    PICKUP_EVENT: "Recojo en evento",
    SHIPPING_HOME: "Envío a domicilio",
    PICKUP_OFFICE: "Recojo en sede Campo de Marte",
}

function formatDate(value: Date | null): string {
    if (!value) return "—"
    return value.toLocaleString("es-PE", {
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

function fulfillmentMessage(status: FulfillmentStatus, deliveryMethod: DeliveryMethod | null): string {
    if (status === "PENDING") {
        return "Estamos preparando tu pedido. Te avisaremos cuando esté listo."
    }
    if (status === "READY") {
        return deliveryMethod === "SHIPPING_HOME"
            ? "Tu pedido está empacado. Pronto lo entregaremos al courier."
            : "Tu pedido está listo. Acércate a la sede Campo de Marte con tu DNI."
    }
    if (status === "SHIPPED") {
        return "Tu pedido fue despachado y va en camino a tu dirección."
    }
    if (status === "DELIVERED") {
        return "¡Tu pedido fue entregado! Esperamos que disfrutes tu merch oficial."
    }
    if (status === "PICKED_UP") {
        return "¡Gracias por recoger tu pedido!"
    }
    return "Tu pedido fue cancelado. Si necesitas ayuda, contáctanos por WhatsApp."
}

export default async function MyMerchOrdersPage() {
    const user = await getCurrentUser()
    if (!user) {
        redirect("/login?redirect=/mi-cuenta/merch")
    }

    const orders = await prisma.order.findMany({
        where: { userId: user.id, orderType: "MERCH" },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            status: true,
            totalAmount: true,
            shippingCost: true,
            deliveryMethod: true,
            shippingAddress: true,
            shippingDistrito: true,
            shippingPhone: true,
            fulfillmentStatus: true,
            fulfilledAt: true,
            trackingCode: true,
            paidAt: true,
            createdAt: true,
            orderItems: {
                select: {
                    id: true,
                    quantity: true,
                    unitPrice: true,
                    merchSnapshot: true,
                    merchVariant: {
                        select: {
                            size: true,
                            product: { select: { name: true, imageUrl: true, zone: true } },
                        },
                    },
                },
            },
        },
    })

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
            <section className="bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary text-white">
                <div className="max-w-5xl mx-auto px-4 py-10">
                    <Link
                        href="/mi-cuenta"
                        className="inline-flex items-center gap-1 text-sm text-white/85 hover:text-white"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Volver a mi cuenta
                    </Link>
                    <div className="mt-4 flex items-center gap-3">
                        <div className="rounded-2xl bg-white/15 p-3">
                            <ShoppingBag className="h-6 w-6" />
                        </div>
                        <div>
                            <h1 className="font-display text-3xl font-bold">Mis pedidos de merch</h1>
                            <p className="text-sm text-white/85 mt-1">
                                Revisa el estado de cada compra y su entrega.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <section className="max-w-5xl mx-auto px-4 py-8 space-y-4">
                {orders.length === 0 ? (
                    <EmptyState
                        variant="generic"
                        title="Aún no tienes pedidos de merch"
                        description="Explora la tienda oficial y consigue tu polera, gorra o pin del campeonato."
                        action={{ label: "Ir a la tienda", href: "/merch" }}
                    />
                ) : (
                    orders.map((order) => {
                        const fulfillment = order.fulfillmentStatus || "PENDING"
                        const badge = FULFILLMENT_BADGE[fulfillment]
                        const payment = PAYMENT_BADGE[order.status] || PAYMENT_BADGE.PENDING
                        const isShipping = order.deliveryMethod === "SHIPPING_HOME"
                        const message = fulfillmentMessage(fulfillment, order.deliveryMethod)

                        return (
                            <div
                                key={order.id}
                                className="bg-white rounded-2xl border border-border shadow-sm p-5 space-y-4"
                            >
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-mono text-sm font-semibold text-foreground">
                                            #{shortId(order.id)}
                                        </span>
                                        <Badge className={badge.className} variant="outline">
                                            {badge.label}
                                        </Badge>
                                        <Badge className={payment.className} variant="outline">
                                            {payment.label}
                                        </Badge>
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                        {order.paidAt ? "Pagado" : "Creado"}: {formatDate(order.paidAt || order.createdAt)}
                                    </div>
                                </div>

                                {order.status === "PAID" && (
                                    <div className="flex items-start gap-2 text-sm bg-fdnda-light/50 border border-fdnda-primary/10 text-foreground rounded-lg p-3">
                                        {fulfillment === "CANCELLED" ? (
                                            <XCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                                        ) : fulfillment === "DELIVERED" || fulfillment === "PICKED_UP" ? (
                                            <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                                        ) : fulfillment === "SHIPPED" ? (
                                            <Truck className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
                                        ) : (
                                            <Clock className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                                        )}
                                        <span>{message}</span>
                                    </div>
                                )}

                                {order.trackingCode && fulfillment === "SHIPPED" && (
                                    <div className="text-sm flex items-center gap-2">
                                        <Truck className="h-4 w-4 text-muted-foreground" />
                                        <span>
                                            Código de tracking:{" "}
                                            <span className="font-mono font-semibold">{order.trackingCode}</span>
                                        </span>
                                    </div>
                                )}

                                <ul className="divide-y divide-border">
                                    {order.orderItems.map((item) => {
                                        const snap = (item.merchSnapshot && typeof item.merchSnapshot === "object" && !Array.isArray(item.merchSnapshot))
                                            ? (item.merchSnapshot as Record<string, unknown>)
                                            : {}
                                        const name =
                                            (typeof snap.productName === "string" && snap.productName) ||
                                            item.merchVariant?.product.name ||
                                            "Producto"
                                        const size =
                                            (typeof snap.size === "string" && snap.size) ||
                                            item.merchVariant?.size
                                        const imageUrl =
                                            (typeof snap.imageUrl === "string" && snap.imageUrl) ||
                                            item.merchVariant?.product.imageUrl
                                        return (
                                            <li key={item.id} className="py-3 flex items-center gap-3">
                                                <div className="relative h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-gray-100">
                                                    {imageUrl ? (
                                                        <Image
                                                            src={imageUrl}
                                                            alt={name}
                                                            fill
                                                            sizes="56px"
                                                            className="object-contain"
                                                        />
                                                    ) : (
                                                        <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                                                            <Package className="h-6 w-6" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-medium text-foreground text-sm">{name}</div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {size ? `Talla ${size} · ` : ""}
                                                        {item.quantity} unidad{item.quantity > 1 ? "es" : ""}
                                                    </div>
                                                </div>
                                                <div className="text-sm font-semibold text-foreground">
                                                    {formatPrice(Number(item.unitPrice) * item.quantity)}
                                                </div>
                                            </li>
                                        )
                                    })}
                                </ul>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-3 border-t border-border">
                                    <div>
                                        <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">
                                            Entrega
                                        </div>
                                        <div className="flex items-start gap-2">
                                            {isShipping ? (
                                                <Truck className="h-4 w-4 text-muted-foreground mt-0.5" />
                                            ) : (
                                                <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                                            )}
                                            <div>
                                                <div className="font-medium">
                                                    {order.deliveryMethod ? DELIVERY_LABEL[order.deliveryMethod] : "—"}
                                                </div>
                                                {isShipping && order.shippingAddress && (
                                                    <div className="text-xs text-muted-foreground">
                                                        {order.shippingAddress}
                                                        {order.shippingDistrito ? `, ${order.shippingDistrito}` : ""}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="sm:text-right">
                                        <div className="text-xs uppercase font-semibold text-muted-foreground mb-1">
                                            Total pagado
                                        </div>
                                        <div className="font-display text-xl font-bold text-fdnda-primary">
                                            {formatPrice(Number(order.totalAmount))}
                                        </div>
                                        {Number(order.shippingCost ?? 0) > 0 && (
                                            <div className="text-xs text-muted-foreground">
                                                Incluye envío: {formatPrice(Number(order.shippingCost))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}

                <div className="rounded-xl border border-dashed border-border bg-white p-4 text-sm text-muted-foreground flex items-start gap-2">
                    <Mail className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                        Te notificaremos por correo cada vez que cambie el estado de tu pedido. Si necesitas
                        ayuda, escríbenos por WhatsApp al <strong>+51 941 632 535</strong>.
                    </div>
                </div>

                <div className="flex justify-end">
                    <Link href="/merch">
                        <Button variant="outline">Seguir comprando</Button>
                    </Link>
                </div>
            </section>
        </div>
    )
}
