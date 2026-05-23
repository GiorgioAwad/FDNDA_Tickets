"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useSession, signOut } from "next-auth/react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { useCart } from "@/hooks/cart-context"
import { cn } from "@/lib/utils"
import {
    AlertCircle,
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
    Home,
    ScanLine,
    DollarSign,
    BarChart3,
    UserCheck,
    ChevronLeft,
    ChevronRight,
    Bell,
    QrCode,
    Receipt,
    ShoppingBag,
} from "lucide-react"

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

const adminNavigation: NavGroup[] = [
    {
        title: "Principal",
        items: [
            { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
            { label: "Eventos", href: "/admin/eventos", icon: Calendar },
            { label: "Asistencia manual", href: "/admin/asistencia", icon: UserCheck },
        ],
    },
    {
        title: "Ventas",
        items: [
            { label: "Entradas", href: "/admin/entradas", icon: Ticket },
            { label: "Cortesías", href: "/admin/cortesias", icon: Gift },
            { label: "Merch", href: "/admin/merch", icon: ShoppingBag },
            { label: "Ingresos", href: "/admin/ingresos", icon: DollarSign },
        ],
    },
    {
        title: "Reportes",
        items: [
            { label: "Reportes", href: "/admin/reportes", icon: FileText },
            { label: "Reporte merch", href: "/admin/reportes/merch", icon: ShoppingBag },
            { label: "Reclamos", href: "/admin/reclamos", icon: AlertCircle },
            { label: "Estadísticas", href: "/admin/estadisticas", icon: BarChart3 },
            { label: "Diagnóstico QR", href: "/admin/diagnostico-qr", icon: QrCode },
            { label: "Diagnóstico ABIO", href: "/admin/diagnostico-abio", icon: Receipt },
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

const SIDEBAR_COLLAPSED_KEY = "fdnda:admin:sidebar-collapsed"

interface AdminSidebarProps {
    isOpen: boolean
    onClose: () => void
    collapsed: boolean
    onToggleCollapse: () => void
}

function AdminSidebar({ isOpen, onClose, collapsed, onToggleCollapse }: AdminSidebarProps) {
    const pathname = usePathname()
    const { data: session } = useSession()
    const { clearCart } = useCart()

    const handleSignOut = () => {
        clearCart()
        signOut({ callbackUrl: "/" })
    }

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
                        onClick={onClose}
                    />
                )}
            </AnimatePresence>

            <aside
                className={cn(
                    "fixed top-0 left-0 z-50 h-full bg-white border-r border-border shadow-elevated lg:shadow-card",
                    "transform transition-all duration-300 ease-out lg:translate-x-0 lg:static",
                    isOpen ? "translate-x-0" : "-translate-x-full",
                    collapsed ? "w-[72px]" : "w-64"
                )}
            >
                <div className="flex flex-col h-full">
                    {/* Brand */}
                    <div className={cn("flex items-center justify-between p-4 border-b border-border", collapsed && "px-3")}>
                        <Link href="/admin" className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-coral shadow-md">
                                <Image src="/logo.png" alt="FDNDA" width={28} height={28} className="h-7 w-7 object-contain" />
                            </div>
                            {!collapsed && (
                                <div className="min-w-0 leading-tight">
                                    <span className="font-display font-bold text-foreground block">FDNDA</span>
                                    <span className="block text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Admin Panel</span>
                                </div>
                            )}
                        </Link>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="lg:hidden"
                            onClick={onClose}
                            aria-label="Cerrar menú"
                        >
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* Nav */}
                    <nav className="flex-1 overflow-y-auto p-3 space-y-5">
                        {adminNavigation.map((group) => (
                            <div key={group.title}>
                                {!collapsed && (
                                    <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 px-3">
                                        {group.title}
                                    </h3>
                                )}
                                {collapsed && <div className="h-px bg-border mb-2 mx-3" aria-hidden="true" />}
                                <ul className="space-y-0.5">
                                    {group.items.map((item) => {
                                        const isActive = pathname === item.href ||
                                            (item.href !== "/admin" && item.href !== "/admin/reportes" && pathname.startsWith(item.href))
                                        return (
                                            <li key={item.href}>
                                                <Link
                                                    href={item.href}
                                                    onClick={onClose}
                                                    title={collapsed ? item.label : undefined}
                                                    className={cn(
                                                        "relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                                                        isActive
                                                            ? "bg-gradient-to-r from-fdnda-primary/10 to-fdnda-secondary/5 text-fdnda-primary"
                                                            : "text-foreground/75 hover:bg-muted/70 hover:text-foreground"
                                                    )}
                                                >
                                                    {isActive && (
                                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-7 w-1 rounded-r-full bg-coral" aria-hidden="true" />
                                                    )}
                                                    <item.icon className={cn(
                                                        "h-5 w-5 shrink-0 transition-colors",
                                                        isActive ? "text-fdnda-primary" : "text-muted-foreground group-hover:text-foreground"
                                                    )} />
                                                    {!collapsed && (
                                                        <>
                                                            <span className="truncate">{item.label}</span>
                                                            {item.badge != null && (
                                                                <span className="ml-auto bg-coral text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                                                    {item.badge}
                                                                </span>
                                                            )}
                                                        </>
                                                    )}
                                                </Link>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        ))}
                    </nav>

                    {/* Quick actions */}
                    <div className={cn("p-3 border-t border-border space-y-1", collapsed && "px-2")}>
                        <Link href="/scanner" onClick={onClose} title={collapsed ? "Escáner" : undefined}>
                            <button className={cn(
                                "w-full flex items-center gap-2 rounded-xl border border-border bg-card hover:border-coral hover:bg-coral-soft text-foreground hover:text-coral-strong transition-all px-3 py-2 text-sm font-medium",
                                collapsed && "justify-center px-2"
                            )}>
                                <ScanLine className="h-4 w-4 shrink-0" />
                                {!collapsed && <span>Ir al escáner</span>}
                            </button>
                        </Link>
                        <Link href="/" onClick={onClose} title={collapsed ? "Volver al sitio" : undefined}>
                            <button className={cn(
                                "w-full flex items-center gap-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors px-3 py-2 text-sm font-medium",
                                collapsed && "justify-center px-2"
                            )}>
                                <Home className="h-4 w-4 shrink-0" />
                                {!collapsed && <span>Volver al sitio</span>}
                            </button>
                        </Link>
                    </div>

                    {/* User */}
                    <div className={cn("p-3 border-t border-border bg-gradient-to-br from-muted/40 to-transparent", collapsed && "px-2")}>
                        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
                            <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary flex items-center justify-center text-white font-bold ring-2 ring-white shadow-md">
                                {session?.user?.name?.charAt(0).toUpperCase() || "A"}
                            </div>
                            {!collapsed && (
                                <>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-foreground truncate">
                                            {session?.user?.name || "Admin"}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground truncate">
                                            {session?.user?.email}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={handleSignOut}
                                        title="Cerrar sesión"
                                        className="text-muted-foreground hover:text-coral"
                                    >
                                        <LogOut className="h-4 w-4" />
                                    </Button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Collapse toggle (desktop only) */}
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        className="hidden lg:flex items-center justify-center h-7 w-7 rounded-full bg-white border border-border shadow-md absolute -right-3 top-20 hover:bg-fdnda-primary hover:text-white hover:border-fdnda-primary transition-all"
                        aria-label={collapsed ? "Expandir sidebar" : "Colapsar sidebar"}
                    >
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </aside>
        </>
    )
}

interface AdminTopBarProps {
    onMenuClick: () => void
    title?: string
}

function AdminTopBar({ onMenuClick, title }: AdminTopBarProps) {
    const pathname = usePathname()

    const pageTitle = title || (() => {
        if (pathname === "/admin") return "Dashboard"
        if (pathname.includes("/eventos")) return "Eventos"
        if (pathname.includes("/entradas")) return "Entradas"
        if (pathname.includes("/cortesias")) return "Cortesías"
        if (pathname.includes("/ingresos")) return "Ingresos"
        if (pathname.includes("/reportes/merch")) return "Reporte merch"
        if (pathname.includes("/reportes")) return "Reportes"
        if (pathname.includes("/estadisticas")) return "Estadísticas"
        if (pathname.includes("/reclamos")) return "Reclamos"
        if (pathname.includes("/usuarios")) return "Usuarios"
        if (pathname.includes("/configuracion")) return "Configuración"
        if (pathname.includes("/asistencia")) return "Asistencia"
        if (pathname.includes("/diagnostico-qr")) return "Diagnóstico QR"
        if (pathname.includes("/diagnostico-abio")) return "Diagnóstico ABIO"
        return "Admin"
    })()

    return (
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-border">
            <div className="flex items-center justify-between h-16 px-4 lg:px-6">
                <div className="flex items-center gap-3 min-w-0">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="lg:hidden"
                        onClick={onMenuClick}
                        aria-label="Abrir menú"
                    >
                        <Menu className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden sm:block">Panel administrativo</p>
                        <h1 className="font-display text-lg sm:text-xl font-bold text-foreground truncate">{pageTitle}</h1>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Notificaciones">
                        <Bell className="h-5 w-5" />
                    </Button>
                </div>
            </div>
        </header>
    )
}

interface AdminLayoutClientProps {
    children: React.ReactNode
}

export function AdminLayoutClient({ children }: AdminLayoutClientProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [collapsed, setCollapsed] = useState(false)

    useEffect(() => {
        const stored = typeof window !== "undefined" ? localStorage.getItem(SIDEBAR_COLLAPSED_KEY) : null
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of persisted UI preference
        if (stored === "true") setCollapsed(true)
    }, [])

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSidebarOpen(false)
            }
        }
        document.addEventListener("keydown", handleEscape)
        return () => document.removeEventListener("keydown", handleEscape)
    }, [])

    const toggleCollapse = () => {
        const next = !collapsed
        setCollapsed(next)
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/20 via-white to-white">
            <div className="flex relative">
                <AdminSidebar
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                />
                <div className="flex-1 flex flex-col min-h-screen min-w-0">
                    <AdminTopBar onMenuClick={() => setSidebarOpen(true)} />
                    {children}
                </div>
            </div>
        </div>
    )
}
