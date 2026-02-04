"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { formatDate } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { 
    Calendar, 
    MapPin, 
    ArrowRight, 
    ScanLine, 
    Search, 
    Filter,
    X
} from "lucide-react"

type ScannerEvent = {
    id: string
    title: string
    startDate: string
    venue: string
    discipline?: string | null
    isPublished: boolean
}

interface ScannerEventListProps {
    events: ScannerEvent[]
}

export default function ScannerEventList({ events }: ScannerEventListProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedDiscipline, setSelectedDiscipline] = useState<string | null>(null)

    // Get unique disciplines
    const disciplines = useMemo(() => {
        const uniqueDisciplines = new Set<string>()
        events.forEach(event => {
            if (event.discipline) {
                uniqueDisciplines.add(event.discipline)
            }
        })
        return Array.from(uniqueDisciplines).sort()
    }, [events])

    // Filter events
    const filteredEvents = useMemo(() => {
        return events.filter(event => {
            const matchesSearch = searchTerm === "" || 
                event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                event.venue.toLowerCase().includes(searchTerm.toLowerCase())
            
            const matchesDiscipline = selectedDiscipline === null || 
                event.discipline === selectedDiscipline

            return matchesSearch && matchesDiscipline
        })
    }, [events, searchTerm, selectedDiscipline])

    const clearFilters = () => {
        setSearchTerm("")
        setSelectedDiscipline(null)
    }

    const hasActiveFilters = searchTerm !== "" || selectedDiscipline !== null

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-3 rounded-xl bg-blue-600 text-white">
                        <ScanLine className="h-8 w-8" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Scanner FDNDA</h1>
                        <p className="text-gray-500">Selecciona un evento para escanear</p>
                    </div>
                </div>

                {/* Filters */}
                <div className="bg-white rounded-xl shadow-sm p-4 mb-6 space-y-4">
                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <Input
                            type="text"
                            placeholder="Buscar por nombre o lugar..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 h-12"
                        />
                        {searchTerm && (
                            <button
                                onClick={() => setSearchTerm("")}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        )}
                    </div>

                    {/* Discipline filter */}
                    {disciplines.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <Filter className="h-4 w-4 text-gray-500" />
                                <span className="text-sm font-medium text-gray-700">Disciplina</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={() => setSelectedDiscipline(null)}
                                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                                        selectedDiscipline === null
                                            ? "bg-blue-600 text-white"
                                            : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                                >
                                    Todas
                                </button>
                                {disciplines.map(discipline => (
                                    <button
                                        key={discipline}
                                        onClick={() => setSelectedDiscipline(discipline)}
                                        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                                            selectedDiscipline === discipline
                                                ? "bg-blue-600 text-white"
                                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                        }`}
                                    >
                                        {discipline}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Active filters indicator */}
                    {hasActiveFilters && (
                        <div className="flex items-center justify-between pt-2 border-t">
                            <span className="text-sm text-gray-500">
                                {filteredEvents.length} de {events.length} eventos
                            </span>
                            <button
                                onClick={clearFilters}
                                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                            >
                                Limpiar filtros
                            </button>
                        </div>
                    )}
                </div>

                {/* Events list */}
                {filteredEvents.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {filteredEvents.map((event) => (
                            <Link key={event.id} href={`/scanner/evento/${event.id}`}>
                                <Card className="hover:shadow-lg transition-all hover:scale-[1.02] cursor-pointer h-full border-2 border-transparent hover:border-blue-200">
                                    <CardContent className="p-5">
                                        <div className="flex justify-between items-start mb-3">
                                            <Badge variant={event.isPublished ? "default" : "secondary"}>
                                                {event.isPublished ? "Activo" : "Borrador"}
                                            </Badge>
                                            {event.discipline && (
                                                <Badge variant="outline" className="text-xs">
                                                    {event.discipline}
                                                </Badge>
                                            )}
                                        </div>

                                        <h3 className="font-bold text-lg mb-3 line-clamp-2">{event.title}</h3>

                                        <div className="space-y-2 text-sm text-gray-600 mb-4">
                                            <div className="flex items-center gap-2">
                                                <Calendar className="h-4 w-4 text-blue-500" />
                                                <span>{formatDate(new Date(event.startDate))}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <MapPin className="h-4 w-4 text-blue-500" />
                                                <span className="line-clamp-1">{event.venue}</span>
                                            </div>
                                        </div>

                                        <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-700">
                                            <ScanLine className="h-4 w-4" />
                                            Escanear
                                            <ArrowRight className="h-4 w-4" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 bg-white rounded-xl shadow-sm">
                        {hasActiveFilters ? (
                            <>
                                <Search className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                                <h3 className="text-xl font-semibold text-gray-600 mb-2">
                                    Sin resultados
                                </h3>
                                <p className="text-gray-500 mb-4">
                                    No se encontraron eventos con los filtros aplicados.
                                </p>
                                <Button variant="outline" onClick={clearFilters}>
                                    Limpiar filtros
                                </Button>
                            </>
                        ) : (
                            <>
                                <Calendar className="h-16 w-16 mx-auto text-gray-300 mb-4" />
                                <h3 className="text-xl font-semibold text-gray-600 mb-2">
                                    No hay eventos activos
                                </h3>
                                <p className="text-gray-500">
                                    No se encontraron eventos próximos para escanear.
                                </p>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
