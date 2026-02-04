"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { useCart } from "@/hooks/cart-context"
import {
    LayoutDashboard,
    Calendar,
    Ticket,
    Gift,
    FileText,
    Users,
    Settings,
    Menu,
    X,
    LogOut,
    ChevronDown,
    Home,
    ScanLine,
    DollarSign,
    BarChart3,
} from "lucide-react"

// ==================== TYPES ====================

interface NavItem {
    label: string
    href: string
    icon: React.ElementType
    badge?: number
}

interface NavGroup {
    title: string
    items: NavItem[]
}

// ==================== NAVIGATION CONFIG ====================

const adminNavigation: NavGroup[] = [
    {
        title: "Principal",
        items: [
            { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
            { label: "Eventos", href: "/admin/eventos", icon: Calendar },
        ],
    },
    {
        title: "Ventas",
        items: [
            { label: "Entradas", href: "/admin/entradas", icon: Ticket },
            { label: "Cortesías", href: "/admin/cortesias", icon: Gift },
            { label: "Ingresos", href: "/admin/ingresos", icon: DollarSign },
        ],
    },
    {
        title: "Reportes",
        items: [
            { label: "Reportes", href: "/admin/reportes", icon: FileText },
            { label: "Estadísticas", href: "/admin/estadisticas", icon: BarChart3 },
        ],
    },
    {
        title: "Sistema",
        items: [
            { label: "Usuarios", href: "/admin/usuarios", icon: Users },
            { label: "Configuración", href: "/admin/configuracion", icon: Settings },
        ],
    },
]

// ==================== SIDEBAR COMPONENT ====================

interface AdminSidebarProps {
    isOpen: boolean
    onClose: () => void
}

function AdminSidebar({ isOpen, onClose }: AdminSidebarProps) {
    const pathname = usePathname()
    const { data: session } = useSession()
    const { clearCart } = useCart()

    const handleSignOut = () => {
        clearCart()
        signOut({ callbackUrl: "/" })
    }

    return (
        <>
            {/* Mobile overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={onClose}
                />
            )}

            {/* Sidebar */}
            <aside
                className={`
                    fixed top-0 left-0 z-50 h-full w-64 bg-white border-r shadow-lg
                    transform transition-transform duration-300 ease-in-out
                    lg:translate-x-0 lg:static lg:shadow-none
                    ${isOpen ? "translate-x-0" : "-translate-x-full"}
                `}
            >
                <div className="flex flex-col h-full">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b">
                        <Link href="/admin" className="flex items-center gap-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 shadow-md">
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
                                <span className="block text-xs text-gray-500">Admin Panel</span>
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

                    {/* Navigation */}
                    <nav className="flex-1 overflow-y-auto p-4 space-y-6">
                        {adminNavigation.map((group) => (
                            <div key={group.title}>
                                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-3">
                                    {group.title}
                                </h3>
                                <ul className="space-y-1">
                                    {group.items.map((item) => {
                                        const isActive = pathname === item.href || 
                                            (item.href !== "/admin" && pathname.startsWith(item.href))
                                        return (
                                            <li key={item.href}>
                                                <Link
                                                    href={item.href}
                                                    onClick={onClose}
                                                    className={`
                                                        flex items-center gap-3 px-3 py-2.5 rounded-lg
                                                        text-sm font-medium transition-colors
                                                        ${isActive
                                                            ? "bg-blue-50 text-blue-700"
                                                            : "text-gray-700 hover:bg-gray-100"
                                                        }
                                                    `}
                                                >
                                                    <item.icon className={`h-5 w-5 ${isActive ? "text-blue-600" : "text-gray-400"}`} />
                                                    {item.label}
                                                    {item.badge && (
                                                        <span className="ml-auto bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">
                                                            {item.badge}
                                                        </span>
                                                    )}
                                                </Link>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        ))}
                    </nav>

                    {/* Quick Actions */}
                    <div className="p-4 border-t space-y-2">
                        <Link href="/scanner" onClick={onClose}>
                            <Button variant="outline" className="w-full justify-start gap-2">
                                <ScanLine className="h-4 w-4" />
                                Ir al Escáner
                            </Button>
                        </Link>
                        <Link href="/" onClick={onClose}>
                            <Button variant="ghost" className="w-full justify-start gap-2 text-gray-600">
                                <Home className="h-4 w-4" />
                                Volver al sitio
                            </Button>
                        </Link>
                    </div>

                    {/* User Section */}
                    <div className="p-4 border-t bg-gray-50">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-medium">
                                {session?.user?.name?.charAt(0).toUpperCase() || "A"}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                    {session?.user?.name || "Admin"}
                                </p>
                                <p className="text-xs text-gray-500 truncate">
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

// ==================== TOP BAR COMPONENT ====================

interface AdminTopBarProps {
    onMenuClick: () => void
    title?: string
}

function AdminTopBar({ onMenuClick, title }: AdminTopBarProps) {
    const pathname = usePathname()

    // Determine page title from pathname
    const pageTitle = title || (() => {
        if (pathname === "/admin") return "Dashboard"
        if (pathname.includes("/eventos")) return "Eventos"
        if (pathname.includes("/entradas")) return "Entradas"
        if (pathname.includes("/cortesias")) return "Cortesías"
        if (pathname.includes("/ingresos")) return "Ingresos"
        if (pathname.includes("/reportes")) return "Reportes"
        if (pathname.includes("/estadisticas")) return "Estadísticas"
        if (pathname.includes("/usuarios")) return "Usuarios"
        if (pathname.includes("/configuracion")) return "Configuración"
        return "Admin"
    })()

    return (
        <header className="sticky top-0 z-30 bg-white border-b">
            <div className="flex items-center justify-between h-16 px-4 lg:px-6">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="lg:hidden"
                        onClick={onMenuClick}
                    >
                        <Menu className="h-5 w-5" />
                    </Button>
                    <h1 className="text-xl font-bold text-gray-900">{pageTitle}</h1>
                </div>

                {/* Right side actions */}
                <div className="flex items-center gap-2">
                    {/* Add notification bell, search, etc. here if needed */}
                </div>
            </div>
        </header>
    )
}

// ==================== MAIN LAYOUT COMPONENT ====================

interface AdminLayoutClientProps {
    children: React.ReactNode
}

export function AdminLayoutClient({ children }: AdminLayoutClientProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false)

    // Close sidebar on route change (mobile)
    const pathname = usePathname()
    useEffect(() => {
        setSidebarOpen(false)
    }, [pathname])

    // Close sidebar on escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSidebarOpen(false)
            }
        }
        document.addEventListener("keydown", handleEscape)
        return () => document.removeEventListener("keydown", handleEscape)
    }, [])

    return (
        <div className="min-h-screen bg-gray-50">
            <div className="flex">
                {/* Sidebar */}
                <AdminSidebar
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                />

                {/* Main Content */}
                <div className="flex-1 flex flex-col min-h-screen lg:ml-0">
                    <AdminTopBar onMenuClick={() => setSidebarOpen(true)} />
                    <main className="flex-1 p-4 lg:p-6">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    )
}
