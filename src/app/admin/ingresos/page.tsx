"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { PaginationControls } from "@/components/ui/pagination-controls"
import { formatPrice } from "@/lib/utils"
import { formatComprobanteLabel } from "@/lib/billing"
import * as XLSX from "xlsx"
import {
    Loader2,
    DollarSign,
    TrendingUp,
    Percent,
    Download,
    CreditCard,
    CheckCircle,
    Clock,
    XCircle,
    AlertCircle,
    Eye,
    X,
    User,
    Ticket,
    FileText,
    QrCode,
    Search,
    CalendarDays,
} from "lucide-react"

import {
    IZIPAY_COMMISSION_RATE,
    IGV_RATE,
    TOTAL_COMMISSION_RATE,
    USD_TO_PEN_FALLBACK,
    calculateIzipayCommission,
} from "@/lib/commission-rates"

interface ScheduleSelection {
    date: string | null
    shift: string | null
}

interface EventDay {
    date: string | null
    openTime: string
    closeTime: string
}

interface Entitlement {
    date: string | null
    status: string
}

interface OrderTicket {
    id: string
    attendeeName: string | null
    attendeeDni: string | null
    status: string
    ticketCode: string
    entitlements?: Entitlement[]
}

interface OrderItem {
    id: string
    quantity: number
    subtotal: number
    schedule?: ScheduleSelection[]
    ticketType: {
        name: string
        price: number
        event: {
            title: string
            category?: "EVENTO" | "PISCINA_LIBRE" | "ACADEMIA"
        }
    }
    eventDays?: EventDay[]
    tickets: OrderTicket[]
}

interface Order {
    id: string
    totalAmount: number
    status: "PENDING" | "PAID" | "CANCELLED" | "REFUNDED"
    provider: string | null
    providerRef: string | null
    providerOrderNumber: string | null
    providerTransactionId: string | null
    paymentOperationNumber: string | null
    paymentSyncAttempts: number
    paymentLastSyncAt: string | null
    paymentNeedsReview: boolean
    createdAt: string
    paidAt: string | null
    documentType?: string | null
    buyerName?: string | null
    buyerDocNumber?: string | null
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
    items: OrderItem[]
}

interface Pagination {
    page: number
    pageSize: number
    total: number
    totalPages: number
}

interface IncomeData {
    orders: Order[]
    totalPaid: number
    totalPending: number
    totalCancelled: number
    paidOrdersCount?: number
    pagination?: Pagination
}

const CATEGORY_LABELS: Record<string, string> = {
    EVENTO: "Evento",
    PISCINA_LIBRE: "Piscina libre",
    ACADEMIA: "Academia",
}

// Formatea una fecha calendario "YYYY-MM-DD" sin desfase de zona horaria.
function formatCalendarDate(ymd: string | null | undefined): string {
    if (!ymd) return ""
    const date = new Date(`${ymd}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return ymd
    return date.toLocaleDateString("es-PE", {
        weekday: "short",
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    })
}

const PAGE_SIZE = 25

export default function IncomePage() {
    const [data, setData] = useState<IncomeData | null>(null)
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<"all" | "PAID" | "PENDING" | "CANCELLED">("all")
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
    const [usdRate, setUsdRate] = useState<number>(USD_TO_PEN_FALLBACK)
    const [usdRateSource, setUsdRateSource] = useState<"BCRP" | "SUNAT" | "fallback">("fallback")
    const [page, setPage] = useState(1)
    const [searchInput, setSearchInput] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [exporting, setExporting] = useState(false)

    const buildIncomeQuery = useCallback(
        (overrides?: { page?: number; pageSize?: number }) => {
            const params = new URLSearchParams()
            params.set("page", String(overrides?.page ?? page))
            params.set("pageSize", String(overrides?.pageSize ?? PAGE_SIZE))
            if (filter !== "all") params.set("status", filter)
            if (debouncedSearch) params.set("search", debouncedSearch)
            return params.toString()
        },
        [page, filter, debouncedSearch]
    )

    // Debounce de la búsqueda (reinicia a la primera página).
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchInput.trim())
            setPage(1)
        }, 350)
        return () => clearTimeout(timer)
    }, [searchInput])

    // Reiniciar a la primera página al cambiar el filtro de estado.
    useEffect(() => {
        setPage(1)
    }, [filter])

    // Cargar el tipo de cambio una sola vez.
    useEffect(() => {
        const fetchRate = async () => {
            try {
                const rateRes = await fetch("/api/exchange-rate")
                if (rateRes.ok) {
                    const rateResult = await rateRes.json()
                    if (rateResult.success && Number.isFinite(rateResult.data.rate)) {
                        setUsdRate(rateResult.data.rate)
                        setUsdRateSource(rateResult.data.source)
                    }
                }
            } catch (error) {
                console.error("Error loading exchange rate:", error)
            }
        }
        fetchRate()
    }, [])

    // Cargar órdenes en cada cambio de página/filtro/búsqueda.
    useEffect(() => {
        let cancelled = false
        const fetchIncome = async () => {
            setLoading(true)
            try {
                const incomeRes = await fetch(`/api/admin/reports/income?${buildIncomeQuery()}`)
                const incomeResult = await incomeRes.json()
                if (!cancelled && incomeResult.success) {
                    setData(incomeResult.data)
                }
            } catch (error) {
                console.error("Error loading income:", error)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        fetchIncome()
        return () => {
            cancelled = true
        }
    }, [buildIncomeQuery])

    if (loading && !data) {
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
    const orders = incomeData.orders
    const pagination = incomeData.pagination

    // Conteo global de órdenes pagadas (de la API), no solo la página actual,
    // para que la comisión fija por transacción se calcule sobre el total real.
    const paidOrdersCount = incomeData.paidOrdersCount ?? orders.filter((order) => order.status === "PAID").length
    const commissionBreakdown = calculateIzipayCommission(incomeData.totalPaid, paidOrdersCount, usdRate)
    const commissionAmount = commissionBreakdown.total
    const fixedFeePerTx = commissionBreakdown.fixedFeePerTx
    const netIncome = incomeData.totalPaid - commissionAmount
    const effectiveRate = incomeData.totalPaid > 0
        ? (commissionAmount / incomeData.totalPaid) * 100
        : TOTAL_COMMISSION_RATE * 100

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

    const getComprobanteBadge = (documentType: string | null | undefined) => {
        if (documentType === "FACTURA") {
            return (
                <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200">
                    <FileText className="h-3 w-3 mr-1" />
                    Factura
                </Badge>
            )
        }
        if (documentType === "BOLETA") {
            return (
                <Badge className="bg-sky-100 text-sky-700 border-sky-200">
                    <FileText className="h-3 w-3 mr-1" />
                    Boleta
                </Badge>
            )
        }
        return <span className="text-gray-400">—</span>
    }

    const getReviewBadge = (order: Order) => {
        if (!order.paymentNeedsReview) {
            return null
        }

        return (
            <Badge className="bg-amber-100 text-amber-700 border-amber-200 mt-2">
                <AlertCircle className="h-3 w-3 mr-1" />
                Revision manual
            </Badge>
        )
    }

    // Día y horario comprado por item: prioriza la selección del comprador
    // (día + turno/horario), luego los días con derecho (entitlements) + horario
    // del día del evento, y por último los días configurados del evento.
    const getItemScheduleRows = (
        item: OrderItem
    ): { key: string; date: string | null; detail: string | null }[] => {
        if (item.schedule && item.schedule.length > 0) {
            return item.schedule.map((selection, idx) => ({
                key: `sel-${idx}`,
                date: selection.date,
                detail: selection.shift,
            }))
        }

        const dayMap = new Map<string, string | null>()
        for (const ticket of item.tickets) {
            for (const entitlement of ticket.entitlements ?? []) {
                if (!entitlement.date || dayMap.has(entitlement.date)) continue
                const day = item.eventDays?.find((d) => d.date === entitlement.date)
                dayMap.set(entitlement.date, day ? `${day.openTime} - ${day.closeTime}` : null)
            }
        }
        if (dayMap.size > 0) {
            return Array.from(dayMap.entries())
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([date, detail]) => ({ key: `ent-${date}`, date, detail }))
        }

        return (item.eventDays ?? []).map((day, idx) => ({
            key: `day-${idx}`,
            date: day.date,
            detail: `${day.openTime} - ${day.closeTime}`,
        }))
    }

    const exportToExcel = async () => {
        const statusMap: Record<string, string> = {
            PAID: "Pagado",
            PENDING: "Pendiente",
            CANCELLED: "Cancelado",
            REFUNDED: "Reembolsado"
        }

        // Traer TODOS los registros que matchean el filtro/búsqueda (no solo la página).
        setExporting(true)
        let exportOrders: Order[] = orders
        try {
            const res = await fetch(
                `/api/admin/reports/income?${buildIncomeQuery({ page: 1, pageSize: 100000 })}`
            )
            const result = await res.json()
            if (result.success) {
                exportOrders = result.data.orders as Order[]
            }
        } catch (error) {
            console.error("Error exporting income:", error)
        } finally {
            setExporting(false)
        }

        // Build data rows
        const excelData: Record<string, string | number>[] = []

        exportOrders.forEach(order => {
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
                    "Comprobante": idx === 0 ? formatComprobanteLabel(order.documentType, "") : "",
                    "Doc. Comprobante": idx === 0 ? (order.buyerDocNumber || "") : "",
                    "Nombre / Razón Social": idx === 0 ? (order.buyerName || "") : "",
                    "Estado": idx === 0 ? statusMap[order.status] || order.status : "",
                    "Revision Manual": idx === 0 ? (order.paymentNeedsReview ? "Si" : "No") : "",
                    "Método Pago": idx === 0 ? (order.provider || "-") : "",
                    "Referencia": idx === 0 ? (order.providerRef || "-") : "",
                    "Numero Operacion Izipay": idx === 0 ? (order.paymentOperationNumber || "-") : "",
                    "Orden Izipay": idx === 0 ? (order.providerOrderNumber || "-") : "",
                    "Transaccion Izipay": idx === 0 ? (order.providerTransactionId || "-") : ""
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
            { wch: 12 },  // Comprobante
            { wch: 16 },  // Doc. Comprobante
            { wch: 28 },  // Nombre / Razón Social
            { wch: 12 },  // Estado
            { wch: 14 },  // Revision Manual
            { wch: 12 },  // Método Pago
            { wch: 20 },  // Referencia
            { wch: 22 },  // Numero Operacion Izipay
            { wch: 18 },  // Orden Izipay
            { wch: 20 },  // Transaccion Izipay
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
                                    Comisión: {(IZIPAY_COMMISSION_RATE * 100).toFixed(2)}% + IGV ({(IGV_RATE * 100).toFixed(0)}%) = <strong>{(TOTAL_COMMISSION_RATE * 100).toFixed(2)}%</strong> + <strong>S/ {fixedFeePerTx.toFixed(2)} fijo</strong> por transacción
                                    <span className="text-xs ml-1">(TC S/ {usdRate.toFixed(4)} {usdRateSource})</span>
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-amber-700">Comisión efectiva</p>
                            <p className="text-2xl font-bold text-amber-900">{effectiveRate.toFixed(2)}%</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Orders Table */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <CardTitle>Historial de Órdenes</CardTitle>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Buscar cliente, email u orden..."
                                    className="pl-9 w-64"
                                    value={searchInput}
                                    onChange={(e) => setSearchInput(e.target.value)}
                                />
                            </div>
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
                                disabled={exporting || orders.length === 0}
                            >
                                {exporting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Download className="h-4 w-4" />
                                )}
                                Exportar Excel
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {orders.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <DollarSign className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p className="font-medium">No hay órdenes para mostrar</p>
                            <p className="text-sm text-gray-400 mt-1">
                                {debouncedSearch
                                    ? "Ningún resultado para tu búsqueda"
                                    : "Las órdenes de compra aparecerán aquí"}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-left text-sm text-gray-500">
                                        <th className="pb-3 font-medium">Orden</th>
                                        <th className="pb-3 font-medium">Operacion Pago</th>
                                        <th className="pb-3 font-medium">Cliente</th>
                                        <th className="pb-3 font-medium">Evento</th>
                                        <th className="pb-3 font-medium">Monto</th>
                                        <th className="pb-3 font-medium">Comprobante</th>
                                        <th className="pb-3 font-medium">Estado</th>
                                        <th className="pb-3 font-medium">Fecha</th>
                                        <th className="pb-3 font-medium"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {orders.map((order) => (
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
                                                {getComprobanteBadge(order.documentType)}
                                            </td>
                                            <td className="py-3">
                                                <div className="flex flex-col items-start">
                                                    {getStatusBadge(order.status)}
                                                    {getReviewBadge(order)}
                                                </div>
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
                    {pagination && pagination.total > 0 && (
                        <PaginationControls
                            page={pagination.page}
                            totalPages={pagination.totalPages}
                            total={pagination.total}
                            onPageChange={setPage}
                            label="órdenes"
                            disabled={loading}
                        />
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
                                        minute: "2-digit",
                                        timeZone: "America/Lima",
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
                                    <div>
                                        <p className="text-gray-500">Comprobante</p>
                                        <div className="mt-0.5">{getComprobanteBadge(selectedOrder.documentType)}</div>
                                    </div>
                                    {(selectedOrder.buyerDocNumber || selectedOrder.buyerName) && (
                                        <div>
                                            <p className="text-gray-500">
                                                {selectedOrder.documentType === "FACTURA"
                                                    ? "RUC / Razón Social"
                                                    : "Documento / Nombre"}
                                            </p>
                                            <p className="font-medium">
                                                {[selectedOrder.buyerDocNumber, selectedOrder.buyerName]
                                                    .filter(Boolean)
                                                    .join(" · ") || "—"}
                                            </p>
                                        </div>
                                    )}
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

                                            {/* Día y horario comprado */}
                                            {(() => {
                                                const rows = getItemScheduleRows(item)
                                                const categoryLabel =
                                                    CATEGORY_LABELS[item.ticketType.event.category ?? "EVENTO"]
                                                return (
                                                    <div className="border-t pt-3 mt-3">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
                                                            <p className="text-xs font-medium text-gray-500">
                                                                Día y horario
                                                                {categoryLabel ? ` · ${categoryLabel}` : ""}
                                                            </p>
                                                        </div>
                                                        {rows.length > 0 ? (
                                                            <div className="space-y-1.5">
                                                                {rows.map((row) => (
                                                                    <div
                                                                        key={row.key}
                                                                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
                                                                    >
                                                                        <span className="font-medium capitalize">
                                                                            {formatCalendarDate(row.date) || "Fecha no definida"}
                                                                        </span>
                                                                        {row.detail && (
                                                                            <span className="text-gray-600 inline-flex items-center gap-1">
                                                                                <Clock className="h-3 w-3 text-gray-400" />
                                                                                {row.detail}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <p className="text-sm text-gray-400">
                                                                Sin horario específico
                                                            </p>
                                                        )}
                                                    </div>
                                                )
                                            })()}

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
                                        {selectedOrder.paymentOperationNumber && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Nro operacion Izipay: {selectedOrder.paymentOperationNumber}
                                            </p>
                                        )}
                                        {selectedOrder.providerOrderNumber && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Orden Izipay: {selectedOrder.providerOrderNumber}
                                            </p>
                                        )}
                                        {selectedOrder.providerTransactionId && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Transacción Izipay: {selectedOrder.providerTransactionId}
                                            </p>
                                        )}
                                        <p className="text-xs text-gray-400 mt-1">
                                            Intentos sync: {selectedOrder.paymentSyncAttempts}
                                        </p>
                                        {selectedOrder.paymentLastSyncAt && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Última sync: {new Date(selectedOrder.paymentLastSyncAt).toLocaleString("es-PE", { timeZone: "America/Lima" })}
                                            </p>
                                        )}
                                        {selectedOrder.paymentNeedsReview && (
                                            <div className="mt-3">
                                                <Badge className="bg-amber-100 text-amber-700 border-amber-200">
                                                    <AlertCircle className="h-3 w-3 mr-1" />
                                                    Requiere revisión manual
                                                </Badge>
                                            </div>
                                        )}
                                        {selectedOrder.paidAt && (
                                            <p className="text-xs text-gray-400 mt-1">
                                                Pagado: {new Date(selectedOrder.paidAt).toLocaleString("es-PE", { timeZone: "America/Lima" })}
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
