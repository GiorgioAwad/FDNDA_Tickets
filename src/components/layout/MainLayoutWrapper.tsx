"use client"

import { usePathname } from "next/navigation"
import { Header } from "./Header"
import { Footer } from "./Footer"
import CartFloatingButton from "@/components/cart/CartFloatingButton"

export function MainLayoutWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const isAdminRoute = pathname?.startsWith("/admin")

    // Para rutas de admin, solo renderizamos el contenido sin header/footer
    if (isAdminRoute) {
        return <>{children}</>
    }

    // Para el resto del sitio, renderizamos el layout completo
    return (
        <div className="flex min-h-screen flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <CartFloatingButton />
            <Footer />
        </div>
    )
}
