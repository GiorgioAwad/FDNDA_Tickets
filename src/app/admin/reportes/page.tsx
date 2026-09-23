"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatPrice } from "@/lib/utils"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import * as XLSX from "xlsx"
import { 
    Loader2, 
    DollarSign, 
    ShoppingCart, 
    Ticket, 
    TrendingUp, 
    Percent,
    Download,
} from "lucide-react"
import { Button } from "@/components/ui/button"

import {
    IZIPAY_COMMISSION_RATE,
    TOTAL_COMMISSION_RATE,
    USD_TO_PEN_FALLBACK,
    calculateIzipayCommission,
} from "@/lib/commission-rates"

interface ReportsData {
    totalRevenue: number
    totalOrders: number
    ticketsSold: number
    monthToDateRevenue: number
    monthlyProjection: number
    projectionElapsedDays: number
    projectionDaysInMonth: number
    chartData: {
        date: string
        amount: number
    }[]
}

export default function ReportsPage() {
    const [data, setData] = useState<ReportsData | null>(null)
    const [loading, setLoading] = useState(true)
    const [period, setPeriod] = useState<"7d" | "30d" | "all">("30d")
    const [usdRate, setUsdRate] = useState<number>(USD_TO_PEN_FALLBACK)
    const [usdRateSource, setUsdRateSource] = useState<"BCRP" | "SUNAT" | "fallback">("fallback")

    useEffect(() => {
        const controller = new AbortController()
        let fetching = false

        const fetchReports = async () => {
            if (fetching) return
            fetching = true
            try {
                const response = await fetch("/api/admin/reports?period=" + period, {
                    signal: controller.signal,
                    cache: "no-store",
                })
                if (!response.ok) throw new Error("Error al cargar reportes")
                const result = await response.json()
                if (!result.success) throw new Error(result.error || "Error al cargar reportes")
                setData(result.data)
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.error("Error loading reports:", error)
                    setData(null)
                }
            } finally {
                fetching = false
                if (!controller.signal.aborted) setLoading(false)
            }
        }

        setLoading(true)
        fetchReports()
        const refreshInterval = setInterval(fetchReports, 5 * 60 * 1000)
        return () => {
            controller.abort()
            clearInterval(refreshInterval)
        }
    }, [period])

    useEffect(() => {
        const controller = new AbortController()
        const fetchRate = async () => {
            try {
                const response = await fetch("/api/exchange-rate", { signal: controller.signal })
                if (!response.ok) return
                const result = await response.json()
                if (result.success && Number.isFinite(result.data?.rate)) {
                    setUsdRate(result.data.rate)
                    setUsdRateSource(result.data.source)
                }
            } catch (error) {
                if (!controller.signal.aborted) console.error("Error loading exchange rate:", error)
            }
        }
        fetchRate()
        return () => controller.abort()
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
    const commissionBreakdown = calculateIzipayCommission(data.totalRevenue, data.totalOrders, usdRate)
    const commissionAmount = commissionBreakdown.total
    const fixedFeePerTx = commissionBreakdown.fixedFeePerTx
    const netRevenue = data.totalRevenue - commissionAmount
    const avgOrderValue = data.totalOrders > 0 ? data.totalRevenue / data.totalOrders : 0
    const effectiveCommissionRate = data.totalRevenue > 0
        ? (commissionAmount / data.totalRevenue) * 100
        : TOTAL_COMMISSION_RATE * 100

    const exportToExcel = () => {
        const wb = XLSX.utils.book_new()

        // Sheet 1: Summary
        const summaryData = [
            { "Métrica": "Ingresos Brutos", "Valor": data.totalRevenue },
            { "Métrica": `Comisión Izipay (${effectiveCommissionRate.toFixed(2)}% efectiva)`, "Valor": commissionAmount },
            { "Métrica": "Ingresos Netos", "Valor": netRevenue },
            { "Métrica": "Total Órdenes", "Valor": data.totalOrders },
            { "Métrica": "Entradas Vendidas", "Valor": data.ticketsSold },
            { "Métrica": "Ticket Promedio", "Valor": avgOrderValue },
            { "Métrica": "Entradas por Orden", "Valor": data.totalOrders > 0 ? data.ticketsSold / data.totalOrders : 0 },
            { "Métrica": "Ventas del Mes Actual", "Valor": data.monthToDateRevenue },
            { "Métrica": "Proyección Mensual", "Valor": data.monthlyProjection },
        ]
        const wsSummary = XLSX.utils.json_to_sheet(summaryData)
        wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }]
        XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen")

        // Sheet 2: Daily Sales
        const dailyData = data.chartData.map(d => ({
            "Fecha": new Date(d.date + "T12:00:00Z").toLocaleDateString("es-PE", { timeZone: "UTC" }),
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
                                <p className="text-xs text-amber-700">{(IZIPAY_COMMISSION_RATE * 100).toFixed(2)}% + IGV ({(TOTAL_COMMISSION_RATE * 100).toFixed(2)}%) + S/ {fixedFeePerTx.toFixed(2)}/tx → {effectiveCommissionRate.toFixed(2)}% efectiva</p>
                                <p className="text-xs text-amber-600 mt-0.5">TC USD: S/ {usdRate.toFixed(4)} ({usdRateSource})</p>
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
                                            const [, month, day] = String(value).split("-").map(Number)
                                            return `${day}/${month}`
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
                                                return new Date(String(label) + "T12:00:00Z").toLocaleDateString("es-PE", {
                                                    timeZone: "UTC",
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
                                {formatPrice(data.monthlyProjection)}
                            </p>
                            <p className="text-xs text-blue-700 mt-1">
                                {formatPrice(data.monthToDateRevenue)} recaudados este mes ÷ {data.projectionElapsedDays} días × {data.projectionDaysInMonth} días
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
