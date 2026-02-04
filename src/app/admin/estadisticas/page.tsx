"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { formatPrice } from "@/lib/utils"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts"
import { 
    Loader2, 
    TrendingUp, 
    Users,
    Calendar,
    Ticket,
    DollarSign,
} from "lucide-react"

// Colores para gráficos
const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"]

interface StatsData {
    salesByEvent: { name: string; total: number }[]
    salesByDay: { date: string; amount: number }[]
    ticketsByType: { name: string; count: number }[]
    topEvents: { title: string; tickets: number; revenue: number }[]
    conversionRate: number
    avgOrderValue: number
}

export default function EstadisticasPage() {
    const [data, setData] = useState<StatsData | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const response = await fetch("/api/admin/reports/stats")
                const result = await response.json()
                if (result.success) {
                    setData(result.data)
                }
            } catch (error) {
                console.error("Error loading stats:", error)
            } finally {
                setLoading(false)
            }
        }

        fetchStats()
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        )
    }

    // Mock data if API doesn't exist yet
    const statsData: StatsData = data || {
        salesByEvent: [],
        salesByDay: [],
        ticketsByType: [],
        topEvents: [],
        conversionRate: 0,
        avgOrderValue: 0,
    }

    return (
        <div className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <TrendingUp className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Tasa Conversión</p>
                                <p className="text-2xl font-bold">{statsData.conversionRate.toFixed(1)}%</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-100">
                                <DollarSign className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Ticket Promedio</p>
                                <p className="text-2xl font-bold">{formatPrice(statsData.avgOrderValue)}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-purple-100">
                                <Calendar className="h-5 w-5 text-purple-600" />
                            </div>
                            <div>
                                <p className="text-xs text-gray-500">Eventos Top</p>
                                <p className="text-2xl font-bold">{statsData.topEvents.length}</p>
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
                                <p className="text-xs text-gray-500">Tipos de Entrada</p>
                                <p className="text-2xl font-bold">{statsData.ticketsByType.length}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Sales Trend */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Tendencia de Ventas</CardTitle>
                        <CardDescription>Últimos 30 días</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {statsData.salesByDay.length > 0 ? (
                            <div className="h-[250px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={statsData.salesByDay}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis 
                                            dataKey="date" 
                                            tick={{ fontSize: 11 }}
                                            tickFormatter={(v) => new Date(v).getDate().toString()}
                                        />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <Tooltip
                                            formatter={(value: number | undefined) => [formatPrice(value || 0), "Ventas"]}
                                            labelFormatter={(label) => new Date(label).toLocaleDateString("es-PE")}
                                        />
                                        <Line 
                                            type="monotone" 
                                            dataKey="amount" 
                                            stroke="#3b82f6" 
                                            strokeWidth={2}
                                            dot={{ fill: "#3b82f6", r: 3 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-[250px] flex items-center justify-center text-gray-400">
                                No hay datos suficientes
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Tickets by Type */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Distribución por Tipo</CardTitle>
                        <CardDescription>Entradas vendidas por tipo</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {statsData.ticketsByType.length > 0 ? (
                            <div className="h-[250px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={statsData.ticketsByType}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="count"
                                            nameKey="name"
                                            label={({ name, percent }) => 
                                                `${name} (${((percent || 0) * 100).toFixed(0)}%)`
                                            }
                                            labelLine={false}
                                        >
                                            {statsData.ticketsByType.map((_, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-[250px] flex items-center justify-center text-gray-400">
                                No hay datos suficientes
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Sales by Event */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="text-lg">Ventas por Evento</CardTitle>
                        <CardDescription>Ingresos totales por evento</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {statsData.salesByEvent.length > 0 ? (
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={statsData.salesByEvent} layout="vertical">
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                        <XAxis type="number" tickFormatter={(v) => `S/${v}`} />
                                        <YAxis 
                                            type="category" 
                                            dataKey="name" 
                                            width={150}
                                            tick={{ fontSize: 11 }}
                                        />
                                        <Tooltip formatter={(value: number | undefined) => [formatPrice(value || 0), "Ingresos"]} />
                                        <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        ) : (
                            <div className="h-[300px] flex items-center justify-center text-gray-400">
                                No hay datos suficientes
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Top Events Table */}
            {statsData.topEvents.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Top Eventos</CardTitle>
                        <CardDescription>Eventos con mayor rendimiento</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-left text-sm text-gray-500">
                                        <th className="pb-3 font-medium">#</th>
                                        <th className="pb-3 font-medium">Evento</th>
                                        <th className="pb-3 font-medium text-right">Entradas</th>
                                        <th className="pb-3 font-medium text-right">Ingresos</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {statsData.topEvents.map((event, index) => (
                                        <tr key={index} className="text-sm">
                                            <td className="py-3 text-gray-500">{index + 1}</td>
                                            <td className="py-3 font-medium">{event.title}</td>
                                            <td className="py-3 text-right">{event.tickets}</td>
                                            <td className="py-3 text-right font-medium text-green-600">
                                                {formatPrice(event.revenue)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
