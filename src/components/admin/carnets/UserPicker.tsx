"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export type CarnetUser = { id: string; name: string; email: string }

interface Props {
    value: CarnetUser | null
    onChange: (user: CarnetUser | null) => void
}

export function UserPicker({ value, onChange }: Props) {
    const [term, setTerm] = useState("")
    const [results, setResults] = useState<CarnetUser[]>([])
    const [loading, setLoading] = useState(false)
    const requestIdRef = useRef(0)

    useEffect(() => {
        const query = term.trim()
        if (value || query.length < 3) {
            // Also covers the case where a request was pending (loading = true)
            // and the user deleted characters before the debounce timer fired:
            // the cleanup below cancels the timer, so nothing else would ever
            // clear the flag.
            setLoading(false)
            setResults([])
            return
        }

        // Tags this effect run so a response/abort from a superseded run can
        // never overwrite the results or loading flag of a newer one, even if
        // it resolves out of order.
        const requestId = ++requestIdRef.current
        setLoading(true)
        // Drop the previous query's results immediately so nothing stale is
        // visible underneath "Buscando..." while the new search is in flight.
        setResults([])

        const controller = new AbortController()
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(
                    `/api/admin/users?search=${encodeURIComponent(query)}&pageSize=10`,
                    { signal: controller.signal }
                )
                const json = await res.json()
                if (requestIdRef.current !== requestId) return
                // /api/admin/users responde { success, data: { users, ... } }
                setResults(json?.success ? json.data.users : [])
            } catch {
                if (requestIdRef.current !== requestId) return
                setResults([])
            } finally {
                if (requestIdRef.current === requestId) setLoading(false)
            }
        }, 300)

        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [term, value])

    if (value) {
        return (
            <Card>
                <CardContent className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{value.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{value.email}</p>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                            onChange(null)
                            setTerm("")
                        }}
                    >
                        Cambiar
                    </Button>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-2">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                    type="search"
                    value={term}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="Busca por nombre o correo (minimo 3 letras)"
                    aria-label="Buscar usuario por nombre o correo"
                    className="pl-9"
                />
            </div>
            {loading && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Buscando...
                </p>
            )}
            {!loading && term.trim().length >= 3 && results.length === 0 && (
                <p className="text-xs text-muted-foreground">
                    Sin resultados. El titular debe existir en la web; el panel no crea usuarios.
                </p>
            )}
            {!loading && results.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-input">
                    {results.map((user) => (
                        <li key={user.id}>
                            <button
                                type="button"
                                onClick={() => onChange(user)}
                                className="w-full px-3 py-2 text-left hover:bg-muted"
                            >
                                <span className="block text-sm text-foreground">{user.name}</span>
                                <span className="block text-xs text-muted-foreground">{user.email}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
