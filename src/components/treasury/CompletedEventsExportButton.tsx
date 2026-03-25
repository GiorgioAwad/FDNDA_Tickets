"use client"

import * as XLSX from "xlsx"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export interface CompletedEventExportRow {
    title: string
    category: string
    venue: string
    location: string
    startDate: string
    endDate: string
    totalOrders: number
    ticketsSold: number
    grossRevenue: number
    commissionAmount: number
    advanceAmount: number
    depositedAmount: number
}

export function CompletedEventsExportButton({
    rows,
    filenamePrefix,
    label = "Descargar culminados",
}: {
    rows: CompletedEventExportRow[]
    filenamePrefix: string
    label?: string
}) {
    const handleExport = () => {
        if (rows.length === 0) return

        const workbook = XLSX.utils.book_new()
        const worksheet = XLSX.utils.json_to_sheet(
            rows.map((row) => ({
                "Tipo": row.category,
                "Evento": row.title,
                "Sede": row.venue,
                "Ubicacion": row.location,
                "Fecha inicio": row.startDate,
                "Fecha fin": row.endDate,
                "Ordenes pagadas": row.totalOrders,
                "Entradas vendidas": row.ticketsSold,
                "Recaudacion": row.grossRevenue,
                "Comision + IGV": row.commissionAmount,
                "Adelanto": row.advanceAmount,
                "Monto depositado": row.depositedAmount,
            }))
        )

        worksheet["!cols"] = [
            { wch: 18 },
            { wch: 32 },
            { wch: 22 },
            { wch: 20 },
            { wch: 16 },
            { wch: 16 },
            { wch: 16 },
            { wch: 18 },
            { wch: 16 },
            { wch: 16 },
            { wch: 14 },
            { wch: 18 },
        ]

        XLSX.utils.book_append_sheet(workbook, worksheet, "Eventos culminados")

        const safeDate = new Date().toISOString().split("T")[0]
        XLSX.writeFile(workbook, `${filenamePrefix}_${safeDate}.xlsx`)
    }

    return (
        <Button variant="outline" onClick={handleExport} disabled={rows.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            {label}
        </Button>
    )
}
