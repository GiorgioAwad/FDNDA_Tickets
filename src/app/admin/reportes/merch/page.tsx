"use client"

import { useEffect, useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatPrice } from "@/lib/utils"
import {
    AlertCircle,
    CheckCircle,
    Clock,
    Download,
    Loader2,
    Package,
    Search,
    ShoppingBag,
    Truck,
    XCircle,
} from "lucide-react"

type OrderStatus = "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"

interface MerchReportItem {
    id: string
    productName: string
    category: string
    zone: string
    size: string | null
    sku: string | null
    quantity: number
    unitPrice: number
    subtotal: number
}

interface MerchReportOrder {
    id: string
    status: OrderStatus
    totalAmount: number
    provider: string | null
    providerRef: string | null
    providerOrderNumber: string | null
    providerTransactionId: string | null
    paymentOperationNumber: string | null
    paymentMethod: string | null
    paymentNeedsReview: boolean
    createdAt: string
    paidAt: string | null
    deliveryMethod: "PICKUP_EVENT" | "SHIPPING_HOME" | "PICKUP_OFFICE" | null
    fulfillmentStatus: string | null
    shippingCost: number
    shippingAddress: string | null
    shippingDistrito: string | null
    shippingUbigeo: string | null
    shippingReference: string | null
    shippingPhone: string | null
    buyerDocNumber: string | null
    buyerName: string | null
    buyerPhone: string | null
    user: {
        name: string | null
        email: string
    }
    items: MerchReportItem[]
}

interface MerchReportData {
    totalPaid: number
    totalPending: number
    totalCancelled: number
    totalItemsSold: number
    provinceShipments: number
    orders: MerchReportOrder[]
}

const statusLabel: Record<OrderStatus, string> = {
    PAID: "Pagado",
    PENDING: "Pendiente",
    CANCELLED: "Cancelado",
    REFUNDED: "Reembolsado",
}

function getStatusBadge(status: OrderStatus) {
    switch (status) {
        case "PAID":
            return <Badge className="bg-green-100 text-green-700 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Pagado</Badge>
        case "PENDING":
            return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200"><Clock className="h-3 w-3 mr-1" />Pendiente</Badge>
        case "CANCELLED":
            return <Badge className="bg-red-100 text-red-700 border-red-200"><XCircle className="h-3 w-3 mr-1" />Cancelado</Badge>
        case "REFUNDED":
            return <Badge className="bg-gray-100 text-gray-700 border-gray-200">Reembolsado</Badge>
        default:
            return <Badge variant="outline">{status}</Badge>
    }
}

function getDeliveryLabel(order: MerchReportOrder) {
    if (order.deliveryMethod === "SHIPPING_HOME") return "Provincia - envio"
    if (order.deliveryMethod === "PICKUP_OFFICE") return "Recojo Campo de Marte"
    if (order.deliveryMethod === "PICKUP_EVENT") return "Recojo en evento"
    return "-"
}

export default function MerchReportPage() {
    const [data, setData] = useState<MerchReportData | null>(null)
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<"all" | OrderStatus>("all")
    const [searchTerm, setSearchTerm] = useState("")

    useEffect(() => {
        const fetchMerchReport = async () => {
            try {
                const response = await fetch("/api/admin/reports/merch")
                const result = await response.json()
                if (result.success) {
                    setData(result.data)
                }
            } catch (error) {
                console.error("Error loading merch report:", error)
            } finally {
                setLoading(false)
            }
        }

        fetchMerchReport()
    }, [])

    const filteredOrders = useMemo(() => {
        const orders = data?.orders ?? []
        const query = searchTerm.trim().toLowerCase()

        return orders.filter((order) => {
            const matchesFilter = filter === "all" || order.status === filter
            if (!matchesFilter) return false
            if (!query) return true

            const productText = order.items
                .map((item) => `${item.productName} ${item.category} ${item.zone} ${item.sku || ""}`)
                .join(" ")
                .toLowerCase()

            return (
                order.id.toLowerCase().includes(query) ||
                order.paymentOperationNumber?.toLowerCase().includes(query) ||
                order.user.name?.toLowerCase().includes(query) ||
                order.user.email.toLowerCase().includes(query) ||
                productText.includes(query)
            )
        })
    }, [data?.orders, filter, searchTerm])

    const exportToExcel = () => {
        const rows = filteredOrders.flatMap((order) =>
            order.items.map((item) => ({
                "Orden": `#${order.id.slice(-8).toUpperCase()}`,
                "Fecha": new Date(order.createdAt).toLocaleString("es-PE", { timeZone: "America/Lima" }),
                "Fecha Pago": order.paidAt ? new Date(order.paidAt).toLocaleString("es-PE", { timeZone: "America/Lima" }) : "",
                "Estado": statusLabel[order.status] || order.status,
                "Numero Operacion Izipay": order.paymentOperationNumber || "",
                "Metodo Pago": order.paymentMethod || order.provider || "",
                "Referencia": order.providerRef || "",
                "Orden Izipay": order.providerOrderNumber || "",
                "Transaccion Izipay": order.providerTransactionId || "",
                "Cliente": order.buyerName || order.user.name || "",
                "Documento": order.buyerDocNumber || "",
                "Email": order.user.email,
                "Telefono": order.buyerPhone || "",
                "Producto": item.productName,
                "Categoria": item.category,
                "Zona": item.zone,
                "Talla": item.size || "",
                "SKU": item.sku || "",
                "Cantidad": item.quantity,
                "Precio Unitario": item.unitPrice,
                "Subtotal Item": item.subtotal,
                "Metodo Entrega": getDeliveryLabel(order),
                "Costo Envio": order.shippingCost,
                "Direccion Envio": order.shippingAddress || "",
                "Distrito Envio": order.shippingDistrito || "",
                "Ubigeo Envio": order.shippingUbigeo || "",
                "Referencia Envio": order.shippingReference || "",
                "Telefono Envio": order.shippingPhone || "",
                "Total Orden": order.totalAmount,
                "Fulfillment": order.fulfillmentStatus || "",
                "Revision Manual": order.paymentNeedsReview ? "Si" : "No",
            }))
        )

        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(rows)
        ws["!cols"] = [
            { wch: 12 },
            { wch: 20 },
            { wch: 20 },
            { wch: 12 },
            { wch: 24 },
            { wch: 18 },
            { wch: 20 },
            { wch: 18 },
            { wch: 22 },
            { wch: 28 },
            { wch: 14 },
            { wch: 30 },
            { wch: 14 },
            { wch: 32 },
            { wch: 14 },
            { wch: 14 },
            { wch: 10 },
            { wch: 16 },
            { wch: 10 },
            { wch: 14 },
            { wch: 14 },
            { wch: 22 },
            { wch: 12 },
            { wch: 32 },
            { wch: 18 },
            { wch: 14 },
            { wch: 24 },
            { wch: 16 },
            { wch: 14 },
            { wch: 14 },
            { wch: 14 },
        ]

        XLSX.utils.book_append_sheet(wb, ws, "Merch")
        const filterName = filter === "all" ? "todas" : statusLabel[filter].toLowerCase()
        XLSX.writeFile(wb, `reporte_merch_${filterName}_${new Date().toISOString().split("T")[0]}.xlsx`)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        )
    }

    const reportData = data || {
        totalPaid: 0,
        totalPending: 0,
        totalCancelled: 0,
        totalItemsSold: 0,
        provinceShipments: 0,
        orders: [],
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="font-display text-2xl font-bold text-foreground">Reporte de merch</h1>
                    <p className="text-sm text-muted-foreground">
                        Ordenes de poleras, gorras y pines con trazabilidad de pago y entrega.
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={exportToExcel}
                    disabled={filteredOrders.length === 0}
                >
                    <Download className="h-4 w-4" />
                    Exportar Excel
                </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-green-50 border-green-100">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-100">
                                <ShoppingBag className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Ingresos pagados</p>
                                <p className="text-xl font-bold text-green-700">{formatPrice(reportData.totalPaid)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <Package className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Items vendidos</p>
                                <p className="text-xl font-bold">{reportData.totalItemsSold}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-yellow-100">
                                <Clock className="h-5 w-5 text-yellow-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Pendiente</p>
                                <p className="text-xl font-bold">{formatPrice(reportData.totalPending)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-100">
                                <Truck className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Envios provincia</p>
                                <p className="text-xl font-bold">{reportData.provinceShipments}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <CardTitle>Ordenes de merch</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Buscar orden, operacion, cliente..."
                                    className="pl-9 w-72"
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                />
                            </div>
                            <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
                                Todas
                            </Button>
                            <Button variant={filter === "PAID" ? "default" : "outline"} size="sm" onClick={() => setFilter("PAID")}>
                                Pagadas
                            </Button>
                            <Button variant={filter === "PENDING" ? "default" : "outline"} size="sm" onClick={() => setFilter("PENDING")}>
                                Pendientes
                            </Button>
                            <Button variant={filter === "CANCELLED" ? "default" : "outline"} size="sm" onClick={() => setFilter("CANCELLED")}>
                                Canceladas
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p className="font-medium">No hay ordenes de merch para mostrar</p>
                            <p className="text-sm text-gray-400 mt-1">
                                Las compras de merch apareceran aqui.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-left text-sm text-gray-500">
                                        <th className="pb-3 font-medium">Orden</th>
                                        <th className="pb-3 font-medium">Numero operacion</th>
                                        <th className="pb-3 font-medium">Cliente</th>
                                        <th className="pb-3 font-medium">Productos</th>
                                        <th className="pb-3 font-medium">Entrega</th>
                                        <th className="pb-3 font-medium">Monto</th>
                                        <th className="pb-3 font-medium">Estado</th>
                                        <th className="pb-3 font-medium">Fecha</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {filteredOrders.map((order) => (
                                        <tr key={order.id} className="text-sm">
                                            <td className="py-3">
                                                <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                                                    #{order.id.slice(-8).toUpperCase()}
                                                </span>
                                            </td>
                                            <td className="py-3">
                                                <span className="font-mono text-xs text-gray-700">
                                                    {order.paymentOperationNumber || "-"}
                                                </span>
                                            </td>
                                            <td className="py-3 min-w-[180px]">
                                                <p className="font-medium">{order.buyerName || order.user.name || "-"}</p>
                                                <p className="text-xs text-gray-500">{order.user.email}</p>
                                            </td>
                                            <td className="py-3 min-w-[240px]">
                                                <div className="space-y-1">
                                                    {order.items.map((item) => (
                                                        <p key={item.id} className="text-xs">
                                                            <span className="font-semibold">{item.quantity}x</span> {item.productName}
                                                            {item.size ? ` / ${item.size}` : ""}
                                                        </p>
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="py-3 min-w-[170px]">
                                                <p>{getDeliveryLabel(order)}</p>
                                                {order.shippingDistrito && (
                                                    <p className="text-xs text-gray-500">{order.shippingDistrito}</p>
                                                )}
                                            </td>
                                            <td className="py-3 font-medium">{formatPrice(order.totalAmount)}</td>
                                            <td className="py-3">
                                                <div className="flex flex-col items-start gap-1">
                                                    {getStatusBadge(order.status)}
                                                    {order.paymentNeedsReview && (
                                                        <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                                                            Revision manual
                                                        </Badge>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="py-3 text-gray-500">
                                                {new Date(order.createdAt).toLocaleDateString("es-PE", {
                                                    day: "2-digit",
                                                    month: "short",
                                                    year: "numeric",
                                                })}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
