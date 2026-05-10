"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RotateCcw, Home } from "lucide-react"

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error("Global app error:", error)
    }, [error])

    return (
        <div className="relative min-h-[80vh] flex items-center justify-center overflow-hidden bg-gradient-to-br from-fdnda-light/40 via-white to-fdnda-light/20 px-4 py-16">
            <div className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-coral/20 blur-3xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-fdnda-accent/15 blur-3xl" aria-hidden="true" />

            <div className="relative max-w-lg text-center">
                <div className="relative inline-flex items-center justify-center mb-6">
                    <div className="absolute inset-0 rounded-full bg-coral/30 blur-2xl" aria-hidden="true" />
                    <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-coral to-coral-strong text-white shadow-glow-coral">
                        <AlertTriangle className="h-12 w-12" />
                    </div>
                </div>

                <h1 className="font-display text-3xl sm:text-4xl font-bold mb-3">
                    Algo salió mal
                </h1>
                <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                    Tuvimos un problema inesperado. Intenta nuevamente o vuelve al inicio. Si el problema persiste, contáctanos.
                </p>
                {error.digest && (
                    <p className="text-xs text-muted-foreground mb-6 font-mono">
                        Código: {error.digest}
                    </p>
                )}

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Button onClick={reset} variant="coral" size="lg" className="w-full sm:w-auto rounded-full px-7">
                        <RotateCcw className="h-4 w-4" />
                        Intentar nuevamente
                    </Button>
                    <Link href="/">
                        <Button variant="outline" size="lg" className="w-full sm:w-auto rounded-full px-7">
                            <Home className="h-4 w-4" />
                            Volver al inicio
                        </Button>
                    </Link>
                </div>
            </div>
        </div>
    )
}
