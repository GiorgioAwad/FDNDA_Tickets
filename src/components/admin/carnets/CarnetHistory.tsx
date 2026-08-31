"use client"

import { useEffect, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DataTable } from "@/components/ui/data-table"
import { formatPrice } from "@/lib/utils"

/**
 * Forma exacta de GET /api/admin/carnets (src/app/api/admin/carnets/route.ts).
 * El audit blob que escribe issueCarnet trae DOS gates de cupo independientes
 * -- el cupo global del tipo de entrada y el cupo de esa fecha puntual se
 * pueden forzar por separado -- por eso son dos booleanos, no uno solo.
 */
type HistoryItem = {
    orderId: string
    createdAt: string
    amount: number
    issuedByEmail: string
    reason: string
    forcedGlobalCapacity: boolean
    forcedDateCapacity: boolean
    userName: string
    userEmail: string
    ticketCode: string
    attendeeName: string
    eventTitle: string
    ticketTypeName: string
}

/**
 * `createdAt` es un timestamp real (Order.createdAt), no una fecha-only
 * @db.Date -- por eso se formatea directo desde el ISO string en vez de
 * pasar por parseDateInput/formatDateTime de lib/utils.ts: esos helpers
 * aplanan cualquier ISO datetime al mediodia UTC de su dia civil (pensado
 * para columnas @db.Date que perdieron su hora real al serializarse), lo que
 * aca borraria la hora de emision real. Se fuerza America/Lima explicitamente
 * para no heredar la zona horaria del navegador o del contenedor.
 */
function formatEmittedAt(iso: string): string {
    return new Intl.DateTimeFormat("es-PE", {
        timeZone: "America/Lima",
        dateStyle: "medium",
        timeStyle: "short",
    }).format(new Date(iso))
}

const columns: ColumnDef<HistoryItem>[] = [
    {
        id: "createdAt",
        accessorKey: "createdAt",
        header: "Fecha",
        cell: ({ row }) => (
            <span className="whitespace-nowrap text-foreground">
                {formatEmittedAt(row.original.createdAt)}
            </span>
        ),
    },
    {
        id: "titular",
        accessorFn: (item) => `${item.userName} ${item.userEmail}`,
        header: "Titular",
        cell: ({ row }) => (
            <div className="min-w-0 max-w-[14rem]">
                <p className="truncate font-medium text-foreground">{row.original.userName}</p>
                <p className="truncate text-xs text-muted-foreground">{row.original.userEmail}</p>
            </div>
        ),
    },
    {
        id: "attendeeName",
        accessorKey: "attendeeName",
        header: "Asistente",
        cell: ({ row }) => (
            <span className="text-foreground">{row.original.attendeeName}</span>
        ),
    },
    {
        id: "evento",
        accessorFn: (item) => `${item.eventTitle} ${item.ticketTypeName}`,
        header: "Evento / tipo",
        cell: ({ row }) => (
            <div className="min-w-0 max-w-[14rem]">
                <p className="truncate text-foreground">{row.original.eventTitle}</p>
                <p className="truncate text-xs text-muted-foreground">{row.original.ticketTypeName}</p>
            </div>
        ),
    },
    {
        id: "ticketCode",
        accessorKey: "ticketCode",
        header: "Código",
        cell: ({ row }) => (
            <span className="whitespace-nowrap font-mono text-xs text-foreground">
                {row.original.ticketCode}
            </span>
        ),
    },
    {
        id: "amount",
        accessorKey: "amount",
        header: "Monto",
        cell: ({ row }) => (
            <span className="whitespace-nowrap tabular-nums text-foreground">
                {formatPrice(row.original.amount)}
            </span>
        ),
    },
    {
        id: "issuedByEmail",
        accessorKey: "issuedByEmail",
        header: "Emitió por",
        cell: ({ row }) => (
            <span className="break-all text-xs text-muted-foreground">{row.original.issuedByEmail}</span>
        ),
    },
    {
        id: "reason",
        // El motivo entra en la busqueda global; los dos gates de cupo se
        // muestran en el cell de abajo, no aca (son booleanos, no texto).
        accessorKey: "reason",
        header: "Motivo",
        cell: ({ row }) => {
            const item = row.original
            const hasForcedCapacity = item.forcedGlobalCapacity || item.forcedDateCapacity
            return (
                <div className="max-w-xs">
                    <p className="whitespace-pre-wrap break-words text-foreground">
                        {item.reason || "—"}
                    </p>
                    {hasForcedCapacity && (
                        <div className="mt-1 flex flex-wrap gap-1">
                            {item.forcedGlobalCapacity && (
                                <Badge
                                    variant="warning"
                                    title="Se emitio superando el cupo total del tipo de entrada"
                                >
                                    Cupo global forzado
                                </Badge>
                            )}
                            {item.forcedDateCapacity && (
                                <Badge
                                    variant="warning"
                                    title="Se emitio superando el cupo de esa fecha puntual"
                                >
                                    Cupo de fecha forzado
                                </Badge>
                            )}
                        </div>
                    )}
                </div>
            )
        },
    },
]

export function CarnetHistory() {
    const [items, setItems] = useState<HistoryItem[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // Se incrementa desde el boton "Reintentar" del estado de error para
    // volver a disparar el efecto de carga sin duplicar la logica de fetch.
    const [reloadKey, setReloadKey] = useState(0)

    useEffect(() => {
        let cancelled = false
        // eslint-disable-next-line react-hooks/set-state-in-effect -- senaliza que la carga (re)empezo; se apaga en el finally de la misma solicitud
        setLoading(true)
        setError(null)
        fetch("/api/admin/carnets")
            .then((r) => r.json())
            .then((json) => {
                if (cancelled) return
                if (json?.success) {
                    setItems(json.data.items)
                } else {
                    setItems([])
                    // GET /api/admin/carnets siempre responde con `error`
                    // (string), no con `errors` (array) como las rutas de
                    // previsualizar/emitir -- son sobres distintos.
                    setError(
                        typeof json?.error === "string" && json.error
                            ? json.error
                            : "No se pudo cargar el historial de emisiones."
                    )
                }
            })
            .catch((err) => {
                if (cancelled) return
                console.error("Error de red cargando historial de carnets:", err)
                setItems([])
                setError("No se pudo conectar con el servidor. Revisa tu conexion e intenta de nuevo.")
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [reloadKey])

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-5 w-5 text-muted-foreground" />
                    Últimas emisiones
                </CardTitle>
            </CardHeader>
            <CardContent>
                {error ? (
                    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                        <p>{error}</p>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setReloadKey((key) => key + 1)}
                        >
                            Reintentar
                        </Button>
                    </div>
                ) : (
                    <DataTable
                        columns={columns}
                        data={items}
                        loading={loading}
                        searchPlaceholder="Buscar por titular, evento o código..."
                        emptyTitle="Todavía no se emitió ningún carnet desde el panel"
                        emptyDescription="Los carnets que emitas desde el formulario de arriba van a aparecer aquí."
                        pageSize={10}
                    />
                )}
            </CardContent>
        </Card>
    )
}
