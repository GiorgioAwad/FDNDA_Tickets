"use client"

import { useEffect, useState } from "react"

export type CarnetUser = { id: string; name: string; email: string }

interface Props {
    value: CarnetUser | null
    onChange: (user: CarnetUser | null) => void
}

export function UserPicker({ value, onChange }: Props) {
    const [term, setTerm] = useState("")
    const [results, setResults] = useState<CarnetUser[]>([])
    const [loading, setLoading] = useState(false)

    useEffect(() => {
        const query = term.trim()
        if (value || query.length < 3) {
            setResults([])
            return
        }
        setLoading(true)
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(
                    `/api/admin/users?search=${encodeURIComponent(query)}&pageSize=10`
                )
                const json = await res.json()
                // /api/admin/users responde { success, data: { users, ... } }
                setResults(json?.success ? json.data.users : [])
            } catch {
                setResults([])
            } finally {
                setLoading(false)
            }
        }, 300)
        return () => clearTimeout(timer)
    }, [term, value])

    if (value) {
        return (
            <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                <div>
                    <p className="text-sm font-medium text-gray-900">{value.name}</p>
                    <p className="text-xs text-gray-500">{value.email}</p>
                </div>
                <button
                    type="button"
                    onClick={() => {
                        onChange(null)
                        setTerm("")
                    }}
                    className="text-xs font-medium text-sky-700 hover:underline"
                >
                    Cambiar
                </button>
            </div>
        )
    }

    return (
        <div className="space-y-2">
            <input
                type="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Busca por nombre o correo (minimo 3 letras)"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            {loading && <p className="text-xs text-gray-500">Buscando...</p>}
            {!loading && term.trim().length >= 3 && results.length === 0 && (
                <p className="text-xs text-gray-500">
                    Sin resultados. El titular debe existir en la web; el panel no crea usuarios.
                </p>
            )}
            <ul className="divide-y divide-gray-100">
                {results.map((user) => (
                    <li key={user.id}>
                        <button
                            type="button"
                            onClick={() => onChange(user)}
                            className="w-full px-1 py-2 text-left hover:bg-gray-50"
                        >
                            <span className="block text-sm text-gray-900">{user.name}</span>
                            <span className="block text-xs text-gray-500">{user.email}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    )
}
