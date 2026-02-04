"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/utils"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from "recharts"
import * as XLSX from "xlsx"
import { 
    Loader2, 
    DollarSign, 
    ShoppingCart, 
    Ticket, 
    TrendingUp, 
    Percent,
    Calendar,
    Download,
    Filter,
} from "lucide-react"
import { Button } from "@/components/ui/button"

// Comisión de Izipay (3.99% + IGV)
const IZIPAY_COMMISSION_RATE = 0.0399
const IGV_RATE = 0.18
const TOTAL_COMMISSION_RATE = IZIPAY_COMMISSION_RATE * (1 + IGV_RATE) // ~4.71%

interface ReportsData {
    totalRevenue: number
    totalOrders: number
    ticketsSold: number
    chartData: {
        date: string
        amount: number
    }[]
}

export default function ReportsPage() {
    const [data, setData] = useState<ReportsData | null>(null)
    const [loading, setLoading] = useState(true)
    const [period, setPeriod] = useState<"7d" | "30d" | "all">("30d")

    useEffect(() => {
        const fetchReports = async () => {
            try {
                const response = await fetch("/api/admin/reports")
                const result = await response.json()
                if (result.success) {
                    setData(result.data)
                }
            } catch (error) {
                console.error("Error loading reports:", error)
            } finally {
                setLoading(false)
            }
        }

        fetchReports()
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        )
    }

    if (!data) return <div>Error al cargar reportes</div>

    // Calculate net revenue (after Izipay commission)
    const netRevenue = data.totalRevenue * (1 - TOTAL_COMMISSION_RATE)
    const commissionAmount = data.totalRevenue * TOTAL_COMMISSION_RATE
    const avgOrderValue = data.totalOrders > 0 ? data.totalRevenue / data.totalOrders : 0

    const exportToExcel = () => {
        const wb = XLSX.utils.book_new()

        // Sheet 1: Summary
        const summaryData = [
            { "Métrica": "Ingresos Brutos", "Valor": data.totalRevenue },
            { "Métrica": "Comisión Izipay (4.71%)", "Valor": commissionAmount },
            { "Métrica": "Ingresos Netos", "Valor": netRevenue },
            { "Métrica": "Total Órdenes", "Valor": data.totalOrders },
            { "Métrica": "Entradas Vendidas", "Valor": data.ticketsSold },
            { "Métrica": "Ticket Promedio", "Valor": avgOrderValue },
            { "Métrica": "Entradas por Orden", "Valor": data.totalOrders > 0 ? data.ticketsSold / data.totalOrders : 0 },
        ]
        const wsSummary = XLSX.utils.json_to_sheet(summaryData)
        wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }]
        XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen")

        // Sheet 2: Daily Sales
        const dailyData = data.chartData.map(d => ({
            "Fecha": new Date(d.date).toLocaleDateString("es-PE"),
            "Ventas (S/)": d.amount
        }))
        const wsDaily = XLSX.utils.json_to_sheet(dailyData)
        wsDaily['!cols'] = [{ wch: 15 }, { wch: 15 }]
        XLSX.utils.book_append_sheet(wb, wsDaily, "Ventas Diarias")

        XLSX.writeFile(wb, `reporte_ventas_${new Date().toISOString().split("T")[0]}.xlsx`)
    }

    return (
        <div className="space-y-6">
            {/* Period Filter */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button
                        variant={period === "7d" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPeriod("7d")}
                    >
                        7 días
                    </Button>
                    <Button
                        variant={period === "30d" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPeriod("30d")}
                    >
                        30 días
                    </Button>
                    <Button
                        variant={period === "all" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setPeriod("all")}
                    >
                        Todo
                    </Button>
                </div>
                <Button 
                    variant="outline" 
                    size="sm" 
                    className="gap-2"
                    onClick={exportToExcel}
                >
                    <Download className="h-4 w-4" />
                    Exportar Excel
                </Button>
            </div>

            {/* Main Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <DollarSign className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Ingresos Brutos</p>
                                <p className="text-xl font-bold">{formatPrice(data.totalRevenue)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-green-50 border-green-100">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-100">
                                <TrendingUp className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Ingresos Netos</p>
                                <p className="text-xl font-bold text-green-700">{formatPrice(netRevenue)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-100">
                                <ShoppingCart className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Órdenes</p>
                                <p className="text-xl font-bold">{data.totalOrders}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-orange-100">
                                <Ticket className="h-5 w-5 text-orange-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Entradas Vendidas</p>
                                <p className="text-xl font-bold">{data.ticketsSold}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Commission Info */}
            <Card className="bg-amber-50 border-amber-100">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-amber-100">
                                <Percent className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-amber-900">Comisión Izipay</p>
                                <p className="text-xs text-amber-700">3.99% + IGV = {(TOTAL_COMMISSION_RATE * 100).toFixed(2)}%</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-lg font-bold text-amber-700">-{formatPrice(commissionAmount)}</p>
                            <p className="text-xs text-amber-600">Descontado del total</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Sales Chart */}
                <Card className="lg:col-span-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Ventas por Día</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data.chartData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis 
                                        dataKey="date" 
                                        tick={{ fontSize: 12 }}
                                        tickFormatter={(value) => {
                                            const date = new Date(value)
                                            return `${date.getDate()}/${date.getMonth() + 1}`
                                        }}
                                    />
                                    <YAxis 
                                        tick={{ fontSize: 12 }}
                                        tickFormatter={(value) => `S/${value}`}
                                    />
                                    <Tooltip
                                        formatter={(value: number | undefined) => [formatPrice(value || 0), "Ventas"]}
                                        labelFormatter={(label) => {
                                            if (typeof label === "string" || typeof label === "number") {
                                                return new Date(label).toLocaleDateString("es-PE", {
                                                    weekday: "long",
                                                    day: "numeric",
                                                    month: "long"
                                                })
                                            }
                                            return ""
                                        }}
                                        contentStyle={{
                                            borderRadius: "8px",
                                            border: "1px solid #e5e7eb"
                                        }}
                                    />
                                    <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Additional Stats */}
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg">Métricas</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 rounded-lg bg-gray-50">
                            <p className="text-xs text-gray-500 mb-1">Ticket Promedio</p>
                            <p className="text-2xl font-bold">{formatPrice(avgOrderValue)}</p>
                        </div>

                        <div className="p-4 rounded-lg bg-gray-50">
                            <p className="text-xs text-gray-500 mb-1">Entradas por Orden</p>
                            <p className="text-2xl font-bold">
                                {data.totalOrders > 0 
                                    ? (data.ticketsSold / data.totalOrders).toFixed(1) 
                                    : "0"}
                            </p>
                        </div>

                        <div className="p-4 rounded-lg bg-green-50">
                            <p className="text-xs text-gray-500 mb-1">Margen Neto</p>
                            <p className="text-2xl font-bold text-green-700">
                                {((1 - TOTAL_COMMISSION_RATE) * 100).toFixed(2)}%
                            </p>
                        </div>

                        <div className="p-4 rounded-lg bg-blue-50">
                            <p className="text-xs text-gray-500 mb-1">Proyección Mensual</p>
                            <p className="text-2xl font-bold text-blue-700">
                                {formatPrice((data.totalRevenue / 30) * 30)}
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
