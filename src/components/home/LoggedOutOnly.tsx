"use client"

import { useSession } from "next-auth/react"

/**
 * Renderiza children solo para visitantes NO autenticados.
 *
 * Permite que páginas públicas (home) se rendericen de forma estática/ISR y
 * sean cacheables por Cloudflare: la sesión se resuelve en el cliente, no en
 * el servidor (que emitiría Set-Cookie de NextAuth y rompería el caché del edge).
 */
export function LoggedOutOnly({ children }: { children: React.ReactNode }) {
    const { status } = useSession()
    // Durante "loading"/"unauthenticated" mostramos el contenido (caso público
    // por defecto). Solo lo ocultamos cuando confirmamos sesión activa.
    if (status === "authenticated") return null
    return <>{children}</>
}
