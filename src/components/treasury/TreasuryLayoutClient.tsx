"use client"

import { useEffect, useState } from "react"
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
    BarChart3,
    Calendar,
    DollarSign,
    FileText,
    Home,
    LayoutDashboard,
    LogOut,
    Menu,
    X,
    ChevronLeft,
    ChevronRight,
    Bell,
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
            { label: "Estadísticas", href: "/tesoreria/estadisticas", icon: BarChart3 },
            { label: "Reclamos", href: "/tesoreria/reclamos", icon: AlertCircle },
        ],
    },
]

const SIDEBAR_KEY = "fdnda:treasury:sidebar-collapsed"

function resolveTitle(pathname: string) {
    if (pathname === "/tesoreria") return "Resumen"
    if (pathname.includes("/tesoreria/eventos")) return "Eventos"
    if (pathname.includes("/tesoreria/ingresos")) return "Ingresos"
    if (pathname.includes("/tesoreria/reportes")) return "Reportes"
    if (pathname.includes("/tesoreria/estadisticas")) return "Estadísticas"
    if (pathname.includes("/tesoreria/reclamos")) return "Reclamos"
    return "Tesorería"
}

function TreasurySidebar({
    isOpen,
    onClose,
    collapsed,
    onToggleCollapse,
}: {
    isOpen: boolean
    onClose: () => void
    collapsed: boolean
    onToggleCollapse: () => void
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
                <div className="flex flex-col h-full relative">
                    <div className={cn("flex items-center justify-between p-4 border-b border-border", collapsed && "px-3")}>
                        <Link href="/tesoreria" className="flex items-center gap-2.5 min-w-0">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-coral shadow-md">
                                <Image src="/logo.png" alt="FDNDA" width={28} height={28} className="h-7 w-7 object-contain" />
                            </div>
                            {!collapsed && (
                                <div className="min-w-0 leading-tight">
                                    <span className="font-display font-bold text-foreground block">FDNDA</span>
                                    <span className="block text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">Tesorería</span>
                                </div>
                            )}
                        </Link>
                        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose} aria-label="Cerrar">
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    <nav className="flex-1 overflow-y-auto p-3 space-y-5">
                        {treasuryNavigation.map((group) => (
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
                                            (item.href !== "/tesoreria" && pathname.startsWith(item.href))
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
                                                    {!collapsed && <span className="truncate">{item.label}</span>}
                                                </Link>
                                            </li>
                                        )
                                    })}
                                </ul>
                            </div>
                        ))}
                    </nav>

                    <div className={cn("p-3 border-t border-border space-y-1", collapsed && "px-2")}>
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

                    <div className={cn("p-3 border-t border-border bg-gradient-to-br from-muted/40 to-transparent", collapsed && "px-2")}>
                        <div className={cn("flex items-center gap-3", collapsed && "justify-center")}>
                            <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary flex items-center justify-center text-white font-bold ring-2 ring-white shadow-md">
                                {session?.user?.name?.charAt(0).toUpperCase() || "T"}
                            </div>
                            {!collapsed && (
                                <>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-foreground truncate">
                                            {session?.user?.name || "Tesorería"}
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

                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        className="hidden lg:flex items-center justify-center h-7 w-7 rounded-full bg-white border border-border shadow-md absolute -right-3 top-20 hover:bg-fdnda-primary hover:text-white hover:border-fdnda-primary transition-all"
                        aria-label={collapsed ? "Expandir" : "Colapsar"}
                    >
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </aside>
        </>
    )
}

function TreasuryTopBar({ onMenuClick }: { onMenuClick: () => void }) {
    const pathname = usePathname()
    const title = resolveTitle(pathname)
    return (
        <header className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-border">
            <div className="flex items-center justify-between h-16 px-4 lg:px-6">
                <div className="flex items-center gap-3 min-w-0">
                    <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Menú">
                        <Menu className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground hidden sm:block">Panel de tesorería</p>
                        <h1 className="font-display text-lg sm:text-xl font-bold text-foreground truncate">{title}</h1>
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

export function TreasuryLayoutClient({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [collapsed, setCollapsed] = useState(false)

    useEffect(() => {
        const stored = typeof window !== "undefined" ? localStorage.getItem(SIDEBAR_KEY) : null
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration of persisted UI preference
        if (stored === "true") setCollapsed(true)
    }, [])

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSidebarOpen(false)
        }
        document.addEventListener("keydown", handleEscape)
        return () => document.removeEventListener("keydown", handleEscape)
    }, [])

    const toggleCollapse = () => {
        const next = !collapsed
        setCollapsed(next)
        localStorage.setItem(SIDEBAR_KEY, String(next))
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/20 via-white to-white">
            <div className="flex relative">
                <TreasurySidebar
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                />
                <div className="flex-1 flex flex-col min-h-screen min-w-0">
                    <TreasuryTopBar onMenuClick={() => setSidebarOpen(true)} />
                    <main className="flex-1 p-4 lg:p-6">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    )
}
