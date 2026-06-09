"use client"

import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

interface PaginationControlsProps {
    page: number
    totalPages: number
    total: number
    onPageChange: (page: number) => void
    /** Etiqueta del recurso paginado, ej. "órdenes" o "usuarios". */
    label?: string
    disabled?: boolean
}

export function PaginationControls({
    page,
    totalPages,
    total,
    onPageChange,
    label = "resultados",
    disabled = false,
}: PaginationControlsProps) {
    const safeTotalPages = Math.max(1, totalPages)
    const canPrev = page > 1 && !disabled
    const canNext = page < safeTotalPages && !disabled

    return (
        <div className="flex items-center justify-between flex-wrap gap-3 pt-4 mt-2 border-t">
            <p className="text-sm text-gray-500">
                Página <span className="font-medium text-gray-700">{page}</span> de{" "}
                <span className="font-medium text-gray-700">{safeTotalPages}</span> ·{" "}
                <span className="font-medium text-gray-700">{total}</span> {label}
            </p>
            <div className="flex items-center gap-1">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(1)}
                    disabled={!canPrev}
                    aria-label="Primera página"
                >
                    <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page - 1)}
                    disabled={!canPrev}
                    aria-label="Página anterior"
                >
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(page + 1)}
                    disabled={!canNext}
                    aria-label="Página siguiente"
                >
                    <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange(safeTotalPages)}
                    disabled={!canNext}
                    aria-label="Última página"
                >
                    <ChevronsRight className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
