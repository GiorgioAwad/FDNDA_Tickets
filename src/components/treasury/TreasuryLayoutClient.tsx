"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { useCart } from "@/hooks/cart-context"
import {
    AlertCircle,
    BarChart3,
    Calendar,
    DollarSign,
    FileText,
    Home,
    LayoutDashboard,
    LogOut,
    Menu,
    X,
} from "lucide-react"

interface NavItem {
    label: string
    href: string
    icon: React.ElementType
}

interface NavGroup {
    title: string
    items: NavItem[]
}

const treasuryNavigation: NavGroup[] = [
    {
        title: "Principal",
        items: [
            { label: "Resumen", href: "/tesoreria", icon: LayoutDashboard },
            { label: "Eventos", href: "/tesoreria/eventos", icon: Calendar },
        ],
    },
    {
        title: "Finanzas",
        items: [
            { label: "Ingresos", href: "/tesoreria/ingresos", icon: DollarSign },
            { label: "Reportes", href: "/tesoreria/reportes", icon: FileText },
            { label: "Estadisticas", href: "/tesoreria/estadisticas", icon: BarChart3 },
            { label: "Reclamos", href: "/tesoreria/reclamos", icon: AlertCircle },
        ],
    },
]

function resolveTitle(pathname: string) {
    if (pathname === "/tesoreria") return "Tesoreria"
    if (pathname.includes("/tesoreria/eventos")) return "Eventos"
    if (pathname.includes("/tesoreria/ingresos")) return "Ingresos"
    if (pathname.includes("/tesoreria/reportes")) return "Reportes"
    if (pathname.includes("/tesoreria/estadisticas")) return "Estadisticas"
    if (pathname.includes("/tesoreria/reclamos")) return "Reclamos"
    return "Tesoreria"
}

function TreasurySidebar({
    isOpen,
    onClose,
}: {
    isOpen: boolean
    onClose: () => void
}) {
    const pathname = usePathname()
    const { data: session } = useSession()
    const { clearCart } = useCart()

    const handleSignOut = () => {
        clearCart()
        signOut({ callbackUrl: "/" })
    }

    return (
        <>
            {isOpen && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 lg:hidden"
                    onClick={onClose}
                />
            )}

            <aside
                className={`
                    fixed left-0 top-0 z-50 h-full w-64 border-r bg-white shadow-lg
                    transform transition-transform duration-300 ease-in-out
                    lg:static lg:translate-x-0 lg:shadow-none
                    ${isOpen ? "translate-x-0" : "-translate-x-full"}
                `}
            >
                <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b p-4">
                        <Link href="/tesoreria" className="flex items-center gap-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-600 to-teal-700 shadow-md">
                                <Image
                                    src="/logo.png"
                                    alt="FDNDA"
                                    width={28}
                                    height={28}
                                    className="h-7 w-7 object-contain"
                                />
                            </div>
                            <div>
                                <span className="font-bold text-gray-900">FDNDA</span>
                                <span className="block text-xs text-gray-500">Tesoreria</span>
                            </div>
                        </Link>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={onClose}
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    <nav className="flex-1 space-y-6 overflow-y-auto p-4">
                        {treasuryNavigation.map((group) => (
                            <div key={group.title}>
                                <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
                                    {group.title}
                                </h3>
                                <ul className="space-y-1">
                                    {group.items.map((item) => {
                                        const isActive =
                                            pathname === item.href ||
                                            (item.href !== "/tesoreria" && pathname.startsWith(item.href))

                                        return (
                                            <li key={item.href}>
                                                <Link
                                                    href={item.href}
                                                    onClick={onClose}
                                                    className={`
                                                        flex items-center gap-3 rounded-lg px-3 py-2.5
                                                        text-sm font-medium transition-colors
                                                        ${isActive
                                                            ? "bg-emerald-50 text-emerald-700"
                                                            : "text-gray-700 hover:bg-gray-100"}
                                                    `}
                                                >
                                                    <item.icon
                                                        className={`h-5 w-5 ${isActive ? "text-emerald-600" : "text-gray-400"}`}
                                                    />
                                                    {item.label}
                                                </Link>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        ))}
                    </nav>

                    <div className="space-y-2 border-t p-4">
                        <Link href="/" onClick={onClose}>
                            <Button variant="ghost" className="w-full justify-start gap-2 text-gray-600">
                                <Home className="h-4 w-4" />
                                Volver al sitio
                            </Button>
                        </Link>
                    </div>

                    <div className="border-t bg-gray-50 p-4">
                        <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 font-medium text-white">
                                {session?.user?.name?.charAt(0).toUpperCase() || "T"}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-gray-900">
                                    {session?.user?.name || "Tesoreria"}
                                </p>
                                <p className="truncate text-xs text-gray-500">
                                    {session?.user?.email}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleSignOut}
                                className="text-gray-400 hover:text-red-600"
                            >
                                <LogOut className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </aside>
        </>
    )
}

export function TreasuryLayoutClient({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const pathname = usePathname()

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setSidebarOpen(false)
            }
        }

        document.addEventListener("keydown", handleEscape)
        return () => document.removeEventListener("keydown", handleEscape)
    }, [])

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="flex">
                <TreasurySidebar
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />

                <div className="flex min-h-screen flex-1 flex-col lg:ml-0">
                    <header className="sticky top-0 z-30 border-b bg-white">
                        <div className="flex h-16 items-center justify-between px-4 lg:px-6">
                            <div className="flex items-center gap-4">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="lg:hidden"
                                    onClick={() => setSidebarOpen(true)}
                                >
                                    <Menu className="h-5 w-5" />
                                </Button>
                                <div>
                                    <h1 className="text-xl font-bold text-gray-900">
                                        {resolveTitle(pathname)}
                                    </h1>
                                    <p className="text-xs text-gray-500">
                                        Panel financiero, ingresos y reportes
                                    </p>
                                </div>
                            </div>
                        </div>
                    </header>

                    <main className="flex-1 p-4 lg:p-6">{children}</main>
                </div>
            </div>
        </div>
    )
}
