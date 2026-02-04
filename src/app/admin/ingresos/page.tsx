"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatPrice } from "@/lib/utils"
import * as XLSX from "xlsx"
import { 
    Loader2, 
    DollarSign, 
    TrendingUp, 
    Percent,
    Download,
    Calendar,
    CreditCard,
    CheckCircle,
    Clock,
    XCircle,
    Eye,
    X,
    User,
    Mail,
    Ticket,
    Hash,
    FileText,
    QrCode,
} from "lucide-react"

// Comisión de Izipay (3.99% + IGV)
const IZIPAY_COMMISSION_RATE = 0.0399
const IGV_RATE = 0.18
const TOTAL_COMMISSION_RATE = IZIPAY_COMMISSION_RATE * (1 + IGV_RATE) // ~4.71%

interface OrderTicket {
    id: string
    attendeeName: string | null
    attendeeDni: string | null
    status: string
    ticketCode: string
}

interface Order {
    id: string
    totalAmount: number
    status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"
    provider: string | null
    providerRef: string | null
    createdAt: string
    paidAt: string | null
    discountCode?: {
        code: string
        type: string
        value: number
    } | null
    discountUsage?: {
        amountSaved: number
    } | null
    user: {
        name: string
        email: string
    }
    items: {
        id: string
        quantity: number
        subtotal: number
        ticketType: {
            name: string
            price: number
            event: {
                title: string
            }
        }
        tickets: OrderTicket[]
    }[]
}

interface IncomeData {
    orders: Order[]
    totalPaid: number
    totalPending: number
    totalCancelled: number
}

export default function IncomePage() {
    const [data, setData] = useState<IncomeData | null>(null)
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<"all" | "PAID" | "PENDING" | "CANCELLED">("all")
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

    useEffect(() => {
        const fetchIncome = async () => {
            try {
                const response = await fetch("/api/admin/reports/income")
                const result = await response.json()
                if (result.success) {
                    setData(result.data)
                }
            } catch (error) {
                console.error("Error loading income:", error)
            } finally {
                setLoading(false)
            }
        }

        fetchIncome()
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        )
    }

    // Si no hay API aún, mostrar datos de ejemplo
    const mockData: IncomeData = {
        orders: [],
        totalPaid: 0,
        totalPending: 0,
        totalCancelled: 0,
    }

    const incomeData = data || mockData

    const netIncome = incomeData.totalPaid * (1 - TOTAL_COMMISSION_RATE)
    const commissionAmount = incomeData.totalPaid * TOTAL_COMMISSION_RATE

    const filteredOrders = incomeData.orders.filter(order => 
        filter === "all" || order.status === filter
    )

    const getStatusBadge = (status: Order["status"]) => {
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

    const exportToExcel = () => {
        const statusMap: Record<string, string> = {
            PAID: "Pagado",
            PENDING: "Pendiente",
            CANCELLED: "Cancelado",
            REFUNDED: "Reembolsado"
        }

        // Build data rows
        const excelData: Record<string, string | number>[] = []
        
        filteredOrders.forEach(order => {
            order.items.forEach((item, idx) => {
                excelData.push({
                    "Orden": idx === 0 ? `#${order.id.slice(-8).toUpperCase()}` : "",
                    "Fecha": idx === 0 ? new Date(order.createdAt).toLocaleDateString("es-PE") : "",
                    "Cliente": idx === 0 ? (order.user.name || "") : "",
                    "Email": idx === 0 ? order.user.email : "",
                    "Evento": item.ticketType.event.title,
                    "Tipo Entrada": item.ticketType.name,
                    "Cantidad": item.quantity,
                    "Precio Unitario": item.ticketType.price || 0,
                    "Subtotal": item.subtotal,
                    "Total Orden": idx === 0 ? order.totalAmount : "",
                    "Estado": idx === 0 ? statusMap[order.status] || order.status : "",
                    "Método Pago": idx === 0 ? (order.provider || "-") : "",
                    "Referencia": idx === 0 ? (order.providerRef || "-") : ""
                })
            })
        })

        // Create workbook and worksheet
        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(excelData)

        // Set column widths
        const colWidths = [
            { wch: 12 },  // Orden
            { wch: 12 },  // Fecha
            { wch: 25 },  // Cliente
            { wch: 30 },  // Email
            { wch: 40 },  // Evento
            { wch: 20 },  // Tipo Entrada
            { wch: 10 },  // Cantidad
            { wch: 14 },  // Precio Unitario
            { wch: 12 },  // Subtotal
            { wch: 12 },  // Total Orden
            { wch: 12 },  // Estado
            { wch: 12 },  // Método Pago
            { wch: 20 },  // Referencia
        ]
        ws['!cols'] = colWidths

        XLSX.utils.book_append_sheet(wb, ws, "Órdenes")

        // Generate file name
        const filterName = filter === "all" ? "todas" : statusMap[filter]?.toLowerCase() || filter
        const fileName = `ordenes_${filterName}_${new Date().toISOString().split("T")[0]}.xlsx`

        // Download
        XLSX.writeFile(wb, fileName)
    }

    return (
        <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="bg-green-50 border-green-100">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-100">
                                <DollarSign className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Ingresos Pagados</p>
                                <p className="text-xl font-bold text-green-700">{formatPrice(incomeData.totalPaid)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <TrendingUp className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Ingreso Neto</p>
                                <p className="text-xl font-bold">{formatPrice(netIncome)}</p>
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
                                <p className="text-xl font-bold">{formatPrice(incomeData.totalPending)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-amber-100">
                                <Percent className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Comisión Izipay</p>
                                <p className="text-xl font-bold text-amber-700">-{formatPrice(commissionAmount)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Commission Info */}
            <Card className="bg-amber-50 border-amber-100">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <div className="flex items-center gap-3">
                            <CreditCard className="h-8 w-8 text-amber-600" />
                            <div>
                                <p className="font-medium text-amber-900">Procesador de Pagos: Izipay</p>
                                <p className="text-sm text-amber-700">
                                    Comisión: 3.99% + IGV (18%) = <strong>{(TOTAL_COMMISSION_RATE * 100).toFixed(2)}%</strong> por transacción
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-amber-700">Tu margen neto</p>
                            <p className="text-2xl font-bold text-amber-900">{((1 - TOTAL_COMMISSION_RATE) * 100).toFixed(2)}%</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Orders Table */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-4">
                        <CardTitle>Historial de Órdenes</CardTitle>
                        <div className="flex items-center gap-2">
                            <Button
                                variant={filter === "all" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("all")}
                            >
                                Todas
                            </Button>
                            <Button
                                variant={filter === "PAID" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("PAID")}
                            >
                                Pagadas
                            </Button>
                            <Button
                                variant={filter === "PENDING" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("PENDING")}
                            >
                                Pendientes
                            </Button>
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
                    </div>
                </CardHeader>
                <CardContent>
                    {filteredOrders.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <DollarSign className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p className="font-medium">No hay órdenes para mostrar</p>
                            <p className="text-sm text-gray-400 mt-1">
                                Las órdenes de compra aparecerán aquí
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-left text-sm text-gray-500">
                                        <th className="pb-3 font-medium">Orden</th>
                                        <th className="pb-3 font-medium">Cliente</th>
                                        <th className="pb-3 font-medium">Evento</th>
                                        <th className="pb-3 font-medium">Monto</th>
                                        <th className="pb-3 font-medium">Estado</th>
                                        <th className="pb-3 font-medium">Fecha</th>
                                        <th className="pb-3 font-medium"></th>
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
                                                <div>
                                                    <p className="font-medium">{order.user.name}</p>
                                                    <p className="text-xs text-gray-500">{order.user.email}</p>
                                                </div>
                                            </td>
                                            <td className="py-3">
                                                {order.items[0]?.ticketType.event.title || "-"}
                                            </td>
                                            <td className="py-3 font-medium">
                                                {formatPrice(order.totalAmount)}
                                            </td>
                                            <td className="py-3">
                                                {getStatusBadge(order.status)}
                                            </td>
                                            <td className="py-3 text-gray-500">
                                                {new Date(order.createdAt).toLocaleDateString("es-PE", {
                                                    day: "2-digit",
                                                    month: "short",
                                                    year: "numeric"
                                                })}
                                            </td>
                                            <td className="py-3">
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm"
                                                    onClick={() => setSelectedOrder(order)}
                                                    className="hover:bg-blue-50 hover:text-blue-600"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Modal de Detalle de Orden */}
            {selectedOrder && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-hidden">
                        {/* Header */}
                        <div className="border-b p-6 flex justify-between items-start">
                            <div>
                                <div className="flex items-center gap-3">
                                    <h2 className="text-xl font-bold text-gray-900">
                                        Orden #{selectedOrder.id.slice(-8).toUpperCase()}
                                    </h2>
                                    {getStatusBadge(selectedOrder.status)}
                                </div>
                                <p className="text-sm text-gray-500 mt-1">
                                    {new Date(selectedOrder.createdAt).toLocaleString("es-PE", {
                                        day: "2-digit",
                                        month: "long",
                                        year: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit"
                                    })}
                                </p>
                            </div>
                            <button 
                                onClick={() => setSelectedOrder(null)}
                                className="p-2 hover:bg-gray-100 rounded-full"
                            >
                                <X className="h-5 w-5 text-gray-500" />
                            </button>
                        </div>

                        <div className="overflow-y-auto max-h-[calc(90vh-200px)] p-6 space-y-6">
                            {/* Cliente */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <User className="h-4 w-4" />
                                    Cliente
                                </h3>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div>
                                        <p className="text-gray-500">Nombre</p>
                                        <p className="font-medium">{selectedOrder.user.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-gray-500">Email</p>
                                        <p className="font-medium">{selectedOrder.user.email}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Items de la orden */}
                            <div>
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <Ticket className="h-4 w-4" />
                                    Entradas Compradas
                                </h3>
                                <div className="space-y-4">
                                    {selectedOrder.items.map((item, itemIdx) => (
                                        <div key={item.id || `item-${itemIdx}`} className="border rounded-lg p-4">
                                            <div className="flex justify-between items-start mb-3">
                                                <div>
                                                    <p className="font-medium">{item.ticketType.name}</p>
                                                    <p className="text-sm text-gray-500">{item.ticketType.event.title}</p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-medium">{formatPrice(item.subtotal)}</p>
                                                    <p className="text-xs text-gray-500">
                                                        {item.quantity} x {formatPrice(item.ticketType.price || 0)}
                                                    </p>
                                                </div>
                                            </div>
                                            
                                            {/* Tickets individuales */}
                                            {item.tickets && item.tickets.length > 0 && (
                                                <div className="border-t pt-3 mt-3">
                                                    <p className="text-xs font-medium text-gray-500 mb-2">Asistentes:</p>
                                                    <div className="space-y-2">
                                                        {item.tickets.map((ticket, idx) => (
                                                            <div 
                                                                key={ticket.id || `ticket-${idx}`}
                                                                className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-gray-400 text-xs">#{idx + 1}</span>
                                                                    <span className="font-medium">
                                                                        {ticket.attendeeName || "Sin nombre"}
                                                                    </span>
                                                                    {ticket.attendeeDni && (
                                                                        <span className="text-gray-500">
                                                                            · DNI: {ticket.attendeeDni}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {ticket.status === "USED" ? (
                                                                        <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">
                                                                            <QrCode className="h-3 w-3 mr-1" />
                                                                            Usado
                                                                        </Badge>
                                                                    ) : (
                                                                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100">
                                                                            Activo
                                                                        </Badge>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Resumen de pago */}
                            <div className="bg-gray-50 rounded-lg p-4">
                                <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                                    <CreditCard className="h-4 w-4" />
                                    Resumen de Pago
                                </h3>
                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="text-gray-500">Subtotal</span>
                                        <span>{formatPrice(selectedOrder.items.reduce((acc, item) => acc + item.subtotal, 0))}</span>
                                    </div>
                                    {selectedOrder.discountUsage && selectedOrder.discountCode && (
                                        <div className="flex justify-between text-green-600">
                                            <span className="flex items-center gap-1">
                                                <Percent className="h-3 w-3" />
                                                Descuento ({selectedOrder.discountCode.code})
                                            </span>
                                            <span>-{formatPrice(selectedOrder.discountUsage.amountSaved)}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between font-bold text-base pt-2 border-t">
                                        <span>Total</span>
                                        <span>{formatPrice(selectedOrder.totalAmount)}</span>
                                    </div>
                                </div>

                                {selectedOrder.provider && (
                                    <div className="mt-4 pt-4 border-t">
                                        <div className="flex items-center gap-2 text-sm text-gray-500">
                                            <FileText className="h-4 w-4" />
                                            <span>Método: {selectedOrder.provider}</span>
                                        </div>
                                        {selectedOrder.providerRef && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Ref: {selectedOrder.providerRef}
                                            </p>
                                        )}
                                        {selectedOrder.paidAt && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Pagado: {new Date(selectedOrder.paidAt).toLocaleString("es-PE")}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="border-t p-4 flex justify-end">
                            <Button onClick={() => setSelectedOrder(null)}>
                                Cerrar
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
