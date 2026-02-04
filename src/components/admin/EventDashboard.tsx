"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { formatPrice } from "@/lib/utils"
import { DollarSign, Loader2, ShoppingCart, Ticket, Percent } from "lucide-react"

interface TicketTypeOption {
    id: string
    name: string
}

interface TicketTypeReport {
    id: string
    name: string
    price: number
    currency: string
    capacity: number
    isActive: boolean
    sold: number
    revenue: number
    ordersCount: number
}

interface EventReportData {
    totalRevenue: number
    totalOrders: number
    ticketsSold: number
    commissionPercent: number
    commissionAmount: number
    netRevenue: number
    byTicketType: TicketTypeReport[]
}

interface EventDashboardProps {
    eventId: string
    ticketTypes: TicketTypeOption[]
}

export function EventDashboard({ eventId, ticketTypes }: EventDashboardProps) {
    const [data, setData] = useState<EventReportData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState("")
    const [ticketTypeFilter, setTicketTypeFilter] = useState("all")

    const exportUrl = useMemo(() => {
        const params = new URLSearchParams()
        if (ticketTypeFilter !== "all") {
            params.set("ticketTypeId", ticketTypeFilter)
        }
        const query = params.toString()
        return `/api/admin/events/${eventId}/export${query ? `?${query}` : ""}`
    }, [eventId, ticketTypeFilter])

    const attendeeExportUrl = useMemo(() => {
        const params = new URLSearchParams()
        if (ticketTypeFilter !== "all") {
            params.set("ticketTypeId", ticketTypeFilter)
        }
        const query = params.toString()
        return `/api/admin/events/${eventId}/attendees-export${query ? `?${query}` : ""}`
    }, [eventId, ticketTypeFilter])

    useEffect(() => {
        const fetchReport = async () => {
            setLoading(true)
            setError("")
            try {
                const params = new URLSearchParams()
                if (ticketTypeFilter !== "all") {
                    params.set("ticketTypeId", ticketTypeFilter)
                }
                const query = params.toString()
                const response = await fetch(
                    `/api/admin/events/${eventId}/report${query ? `?${query}` : ""}`
                )
                const result = await response.json()
                if (!response.ok || !result.success) {
                    throw new Error(result.error || "Error al cargar dashboard")
                }
                setData(result.data)
            } catch (err) {
                setError((err as Error).message)
                setData(null)
            } finally {
                setLoading(false)
            }
        }

        fetchReport()
    }, [eventId, ticketTypeFilter])

    const ticketTypeOptions = useMemo(
        () => [{ id: "all", name: "Todas las entradas" }, ...ticketTypes],
        [ticketTypes]
    )

    const totalsCurrency = data?.byTicketType[0]?.currency || "PEN"

    return (
        <section className="space-y-6 mb-10">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h2 className="text-2xl font-semibold">Dashboard del evento</h2>
                    <p className="text-sm text-gray-500">Resumen de ventas y entradas</p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex items-center gap-2">
                        <label htmlFor="ticketTypeFilter" className="text-sm text-gray-600">
                            Filtrar por tipo
                        </label>
                        <select
                            id="ticketTypeFilter"
                            value={ticketTypeFilter}
                            onChange={(e) => setTicketTypeFilter(e.target.value)}
                            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {ticketTypeOptions.map((option) => (
                                <option key={option.id} value={option.id}>
                                    {option.name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <Button variant="outline" asChild>
                        <a href={attendeeExportUrl}>Exportar asistentes</a>
                    </Button>
                    <Button variant="outline" asChild>
                        <a href={exportUrl}>Exportar Excel</a>
                    </Button>
                </div>
            </div>

            {loading && (
                <div className="flex items-center justify-center min-h-[120px]">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
            )}

            {!loading && error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                </div>
            )}

            {!loading && !error && data && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                        <Card>
                            <CardContent className="p-6 flex items-center gap-4">
                                <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                                    <DollarSign className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">Ingresos brutos</div>
                                    <div className="text-2xl font-bold">
                                        {formatPrice(data.totalRevenue, totalsCurrency)}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-6 flex items-center gap-4">
                                <div className="p-3 rounded-full bg-amber-100 text-amber-600">
                                    <Percent className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">
                                        Comision Izipay ({data.commissionPercent}%)
                                    </div>
                                    <div className="text-2xl font-bold">
                                        {formatPrice(data.commissionAmount, totalsCurrency)}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-6 flex items-center gap-4">
                                <div className="p-3 rounded-full bg-emerald-100 text-emerald-600">
                                    <DollarSign className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">Ingreso neto</div>
                                    <div className="text-2xl font-bold">
                                        {formatPrice(data.netRevenue, totalsCurrency)}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-6 flex items-center gap-4">
                                <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                                    <Ticket className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">Entradas vendidas</div>
                                    <div className="text-2xl font-bold">{data.ticketsSold}</div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-6 flex items-center gap-4">
                                <div className="p-3 rounded-full bg-green-100 text-green-600">
                                    <ShoppingCart className="h-6 w-6" />
                                </div>
                                <div>
                                    <div className="text-sm text-gray-500">{"\u00d3rdenes"}</div>
                                    <div className="text-2xl font-bold">{data.totalOrders}</div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Detalle por tipo</CardTitle>
                        </CardHeader>
                        <CardContent className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-gray-500">
                                        <th className="py-2 pr-4 font-medium">Tipo</th>
                                        <th className="py-2 pr-4 font-medium">Precio</th>
                                        <th className="py-2 pr-4 font-medium">Vendidas</th>
                                        <th className="py-2 pr-4 font-medium">Ingresos</th>
                                        <th className="py-2 pr-4 font-medium">{"\u00d3rdenes"}</th>
                                        <th className="py-2 pr-4 font-medium">Capacidad</th>
                                        <th className="py-2 pr-4 font-medium">Disponible</th>
                                        <th className="py-2 pr-4 font-medium">Estado</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.byTicketType.length === 0 && (
                                        <tr>
                                            <td className="py-4 text-gray-500" colSpan={8}>
                                                Sin ventas registradas.
                                            </td>
                                        </tr>
                                    )}
                                    {data.byTicketType.map((ticketType) => {
                                        const capacity = ticketType.capacity
                                        const isUnlimited = capacity === 0
                                        const remaining = isUnlimited
                                            ? null
                                            : Math.max(capacity - ticketType.sold, 0)
                                        return (
                                            <tr key={ticketType.id} className="border-b last:border-0">
                                                <td className="py-3 pr-4 font-medium text-gray-900">
                                                    {ticketType.name}
                                                </td>
                                                <td className="py-3 pr-4">
                                                    {formatPrice(ticketType.price, ticketType.currency)}
                                                </td>
                                                <td className="py-3 pr-4">{ticketType.sold}</td>
                                                <td className="py-3 pr-4">
                                                    {formatPrice(ticketType.revenue, ticketType.currency)}
                                                </td>
                                                <td className="py-3 pr-4">{ticketType.ordersCount}</td>
                                                <td className="py-3 pr-4">
                                                    {isUnlimited ? "Ilimitado" : capacity}
                                                </td>
                                                <td className="py-3 pr-4">
                                                    {isUnlimited ? "Ilimitado" : remaining}
                                                </td>
                                                <td className="py-3 pr-4">
                                                    {ticketType.isActive ? "Activo" : "Inactivo"}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </CardContent>
                    </Card>

                </>
            )}
        </section>
    )
}
