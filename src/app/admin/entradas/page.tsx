"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatPrice } from "@/lib/utils"
import * as XLSX from "xlsx"
import { 
    Loader2, 
    Ticket, 
    Search,
    Download,
    Calendar,
    User,
    CheckCircle,
    XCircle,
    QrCode,
    Filter,
    Eye,
} from "lucide-react"

interface TicketData {
    id: string
    ticketCode: string
    attendeeName: string | null
    attendeeDni: string | null
    status: "ACTIVE" | "EXPIRED" | "CANCELLED"
    createdAt: string
    ticketType: {
        name: string
        price: number
    }
    event: {
        title: string
    }
    user: {
        name: string
        email: string
    }
    _count: {
        scans: number
    }
}

interface TicketsPageData {
    tickets: TicketData[]
    total: number
    active: number
    used: number
    cancelled: number
}

export default function EntradasPage() {
    const [data, setData] = useState<TicketsPageData | null>(null)
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [filter, setFilter] = useState<"all" | "ACTIVE" | "EXPIRED" | "CANCELLED">("all")

    useEffect(() => {
        const fetchTickets = async () => {
            try {
                const response = await fetch("/api/admin/reports/tickets")
                const result = await response.json()
                if (result.success) {
                    setData(result.data)
                }
            } catch (error) {
                console.error("Error loading tickets:", error)
            } finally {
                setLoading(false)
            }
        }

        fetchTickets()
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[50vh]">
                <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            </div>
        )
    }

    const ticketsData = data || { tickets: [], total: 0, active: 0, used: 0, cancelled: 0 }

    // Filter tickets
    const filteredTickets = ticketsData.tickets.filter(ticket => {
        const matchesFilter = filter === "all" || ticket.status === filter
        const matchesSearch = searchTerm === "" || 
            ticket.ticketCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
            ticket.attendeeName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            ticket.attendeeDni?.includes(searchTerm) ||
            ticket.user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            ticket.user.email.toLowerCase().includes(searchTerm.toLowerCase())
        return matchesFilter && matchesSearch
    })

    const getStatusBadge = (status: TicketData["status"]) => {
        switch (status) {
            case "ACTIVE":
                return <Badge className="bg-green-100 text-green-700 border-green-200"><CheckCircle className="h-3 w-3 mr-1" />Activa</Badge>
            case "EXPIRED":
                return <Badge className="bg-blue-100 text-blue-700 border-blue-200"><QrCode className="h-3 w-3 mr-1" />Usada</Badge>
            case "CANCELLED":
                return <Badge className="bg-red-100 text-red-700 border-red-200"><XCircle className="h-3 w-3 mr-1" />Cancelada</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    const exportToExcel = () => {
        const statusMap: Record<string, string> = {
            ACTIVE: "Activa",
            EXPIRED: "Usada",
            CANCELLED: "Cancelada"
        }

        const excelData = filteredTickets.map(ticket => ({
            "Código": ticket.ticketCode,
            "Asistente": ticket.attendeeName || "-",
            "DNI": ticket.attendeeDni || "-",
            "Evento": ticket.event.title,
            "Tipo de Entrada": ticket.ticketType.name,
            "Precio": ticket.ticketType.price,
            "Estado": statusMap[ticket.status] || ticket.status,
            "Escaneos": ticket._count.scans,
            "Comprador": ticket.user.name,
            "Email Comprador": ticket.user.email,
            "Fecha Creación": new Date(ticket.createdAt).toLocaleDateString("es-PE")
        }))

        const wb = XLSX.utils.book_new()
        const ws = XLSX.utils.json_to_sheet(excelData)

        ws['!cols'] = [
            { wch: 18 },  // Código
            { wch: 25 },  // Asistente
            { wch: 12 },  // DNI
            { wch: 40 },  // Evento
            { wch: 30 },  // Tipo de Entrada
            { wch: 10 },  // Precio
            { wch: 12 },  // Estado
            { wch: 10 },  // Escaneos
            { wch: 25 },  // Comprador
            { wch: 30 },  // Email
            { wch: 14 },  // Fecha
        ]

        XLSX.utils.book_append_sheet(wb, ws, "Entradas")

        const filterName = filter === "all" ? "todas" : statusMap[filter]?.toLowerCase() || filter
        XLSX.writeFile(wb, `entradas_${filterName}_${new Date().toISOString().split("T")[0]}.xlsx`)
    }

    return (
        <div className="space-y-6">
            {/* Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <Ticket className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{ticketsData.total}</p>
                                <p className="text-xs text-gray-500">Total Entradas</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-green-100">
                                <CheckCircle className="h-5 w-5 text-green-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{ticketsData.active}</p>
                                <p className="text-xs text-gray-500">Activas</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-blue-100">
                                <QrCode className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{ticketsData.used}</p>
                                <p className="text-xs text-gray-500">Usadas</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-red-100">
                                <XCircle className="h-5 w-5 text-red-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{ticketsData.cancelled}</p>
                                <p className="text-xs text-gray-500">Canceladas</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Search and Filters */}
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <CardTitle>Listado de Entradas</CardTitle>
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input
                                    placeholder="Buscar código, nombre, DNI..."
                                    className="pl-9 w-64"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
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
                                variant={filter === "ACTIVE" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("ACTIVE")}
                            >
                                Activas
                            </Button>
                            <Button
                                variant={filter === "EXPIRED" ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilter("EXPIRED")}
                            >
                                Usadas
                            </Button>
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="gap-2"
                                onClick={exportToExcel}
                                disabled={filteredTickets.length === 0}
                            >
                                <Download className="h-4 w-4" />
                                Exportar Excel
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {filteredTickets.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Ticket className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                            <p className="font-medium">No hay entradas para mostrar</p>
                            <p className="text-sm text-gray-400 mt-1">
                                {searchTerm ? "Intenta con otra búsqueda" : "Las entradas vendidas aparecerán aquí"}
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b text-left text-sm text-gray-500">
                                        <th className="pb-3 font-medium">Código</th>
                                        <th className="pb-3 font-medium">Asistente</th>
                                        <th className="pb-3 font-medium">Evento</th>
                                        <th className="pb-3 font-medium">Tipo</th>
                                        <th className="pb-3 font-medium">Estado</th>
                                        <th className="pb-3 font-medium">Escaneos</th>
                                        <th className="pb-3 font-medium">Comprador</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {filteredTickets.slice(0, 50).map((ticket) => (
                                        <tr key={ticket.id} className="text-sm hover:bg-gray-50">
                                            <td className="py-3">
                                                <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">
                                                    {ticket.ticketCode}
                                                </span>
                                            </td>
                                            <td className="py-3">
                                                <div>
                                                    <p className="font-medium">{ticket.attendeeName || "-"}</p>
                                                    <p className="text-xs text-gray-500">{ticket.attendeeDni || "-"}</p>
                                                </div>
                                            </td>
                                            <td className="py-3 max-w-[200px] truncate">
                                                {ticket.event.title}
                                            </td>
                                            <td className="py-3">
                                                <div>
                                                    <p>{ticket.ticketType.name}</p>
                                                    <p className="text-xs text-gray-500">{formatPrice(ticket.ticketType.price)}</p>
                                                </div>
                                            </td>
                                            <td className="py-3">
                                                {getStatusBadge(ticket.status)}
                                            </td>
                                            <td className="py-3 text-center">
                                                <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium ${
                                                    ticket._count.scans > 0 
                                                        ? "bg-blue-100 text-blue-700" 
                                                        : "bg-gray-100 text-gray-500"
                                                }`}>
                                                    {ticket._count.scans}
                                                </span>
                                            </td>
                                            <td className="py-3">
                                                <div>
                                                    <p className="text-xs">{ticket.user.name}</p>
                                                    <p className="text-xs text-gray-400">{ticket.user.email}</p>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {filteredTickets.length > 50 && (
                                <div className="text-center py-4 text-sm text-gray-500">
                                    Mostrando 50 de {filteredTickets.length} entradas
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
