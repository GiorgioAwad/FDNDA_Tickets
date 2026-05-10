"use client"

import Link from "next/link"
import Image from "next/image"
import { useSession, signOut } from "next-auth/react"
import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { motion, AnimatePresence, useScroll, useSpring } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCart } from "@/hooks/cart-context"
import { cn } from "@/lib/utils"
import {
    Menu,
    X,
    User,
    Ticket,
    LogOut,
    LayoutDashboard,
    ScanLine,
    Search,
    Calendar,
    Home,
    ChevronRight,
    ChevronDown,
    DollarSign,
    LifeBuoy,
} from "lucide-react"

export function Header() {
    const { data: session, status } = useSession()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [isVisible, setIsVisible] = useState(true)
    const [lastScrollY, setLastScrollY] = useState(0)
    const [searchFocused, setSearchFocused] = useState(false)
    const [openSection, setOpenSection] = useState<string | null>("account")
    const { clearCart } = useCart()
    const router = useRouter()
    const pathname = usePathname()

    const { scrollYProgress } = useScroll()
    const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.2 })

    const isAdmin = session?.user?.role === "ADMIN"
    const isTreasury = session?.user?.role === "TREASURY" || isAdmin
    const isStaff = session?.user?.role === "STAFF" || isAdmin

    useEffect(() => {
        const controlHeader = () => {
            const currentScrollY = window.scrollY
            if (currentScrollY < 10) {
                setIsVisible(true)
            } else if (currentScrollY > lastScrollY && currentScrollY > 80) {
                setIsVisible(false)
                setMobileMenuOpen(false)
            } else if (currentScrollY < lastScrollY) {
                setIsVisible(true)
            }
            setLastScrollY(currentScrollY)
        }
        window.addEventListener("scroll", controlHeader)
        return () => window.removeEventListener("scroll", controlHeader)
    }, [lastScrollY])

    useEffect(() => {
        if (mobileMenuOpen) {
            document.body.style.overflow = "hidden"
        } else {
            document.body.style.overflow = ""
        }
        return () => { document.body.style.overflow = "" }
    }, [mobileMenuOpen])

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        if (searchTerm.trim()) {
            router.push("/eventos?search=" + encodeURIComponent(searchTerm.trim()))
            setSearchTerm("")
            setSearchFocused(false)
            setMobileMenuOpen(false)
        }
    }

    const isActive = (path: string) => pathname === path
    const startsWith = (path: string) => pathname.startsWith(path)

    const drawerVariants = {
        hidden: { x: "-100%" },
        visible: { x: 0, transition: { duration: 0.35, ease: [0.16, 1, 0.3, 1] as const } },
        exit: { x: "-100%", transition: { duration: 0.25, ease: [0.4, 0, 1, 1] as const } },
    }

    const drawerListVariants = {
        hidden: {},
        visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } },
    }

    const drawerItemVariants = {
        hidden: { opacity: 0, x: -12 },
        visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const } },
    }

    return (
        <>
            <header
                className={cn(
                    "sticky top-0 z-50 w-full border-b border-border/60 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70 transition-transform duration-300",
                    isVisible ? "translate-y-0" : "-translate-y-full"
                )}
            >
                <div className="container mx-auto px-4">
                    <div className="flex h-16 items-center justify-between gap-3">
                        <button
                            className="md:hidden p-2 -ml-2 rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setMobileMenuOpen(true)}
                            aria-label="Abrir menú"
                        >
                            <Menu className="h-6 w-6" />
                        </button>

                        <Link href="/" className="flex items-center gap-2 shrink-0 group">
                            <motion.div
                                whileHover={{ rotate: -8, scale: 1.06 }}
                                transition={{ type: "spring", stiffness: 400, damping: 12 }}
                                className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5"
                            >
                                <Image src="/logo.png" alt="FDNDA" width={32} height={32} className="h-8 w-8 object-contain" priority />
                            </motion.div>
                            <div className="hidden sm:block leading-tight">
                                <span className="font-display font-bold text-lg text-fdnda-primary">Ticketing</span>
                                <span className="ml-1.5 text-sm text-muted-foreground font-medium">FDNDA</span>
                            </div>
                        </Link>

                        <div className="hidden md:flex flex-1 justify-center max-w-xl mx-4">
                            <form onSubmit={handleSearch} className="relative w-full">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                                <Input
                                    type="text"
                                    placeholder="¿Qué evento buscas?"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    onFocus={() => setSearchFocused(true)}
                                    onBlur={() => setSearchFocused(false)}
                                    className={cn(
                                        "pl-11 pr-14 w-full h-10 text-sm rounded-full border-border bg-muted/40 transition-all duration-300",
                                        searchFocused && "bg-white ring-2 ring-fdnda-primary/30 shadow-md"
                                    )}
                                />
                                <kbd className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:inline-flex h-6 items-center rounded border border-border bg-white px-1.5 text-[10px] font-mono text-muted-foreground">
                                    /
                                </kbd>
                            </form>
                        </div>

                        <nav className="hidden md:flex items-center gap-2 shrink-0">
                            <Link
                                href="/eventos"
                                className={cn(
                                    "text-sm font-medium px-3 py-2 rounded-lg transition-colors",
                                    startsWith("/eventos") ? "text-fdnda-primary bg-fdnda-primary/5" : "text-foreground/80 hover:text-fdnda-primary hover:bg-muted"
                                )}
                            >
                                Eventos
                            </Link>
                            {status === "authenticated" ? (
                                <>
                                    <Link
                                        href="/mi-cuenta/entradas"
                                        className={cn(
                                            "text-sm font-medium px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5",
                                            startsWith("/mi-cuenta/entradas") ? "text-fdnda-primary bg-fdnda-primary/5" : "text-foreground/80 hover:text-fdnda-primary hover:bg-muted"
                                        )}
                                    >
                                        <Ticket className="h-4 w-4" />Mis Entradas
                                    </Link>
                                    {isStaff && (
                                        <Link
                                            href="/scanner"
                                            className={cn(
                                                "text-sm font-medium px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5",
                                                startsWith("/scanner") ? "text-fdnda-primary bg-fdnda-primary/5" : "text-foreground/80 hover:text-fdnda-primary hover:bg-muted"
                                            )}
                                        >
                                            <ScanLine className="h-4 w-4" />Escáner
                                        </Link>
                                    )}
                                    {isTreasury && (
                                        <Link
                                            href="/tesoreria"
                                            className={cn(
                                                "text-sm font-medium px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5",
                                                startsWith("/tesoreria") ? "text-fdnda-primary bg-fdnda-primary/5" : "text-foreground/80 hover:text-fdnda-primary hover:bg-muted"
                                            )}
                                        >
                                            <DollarSign className="h-4 w-4" />Tesorería
                                        </Link>
                                    )}
                                    {isAdmin && (
                                        <Link
                                            href="/admin"
                                            className={cn(
                                                "text-sm font-medium px-3 py-2 rounded-lg transition-colors flex items-center gap-1.5",
                                                startsWith("/admin") ? "text-fdnda-primary bg-fdnda-primary/5" : "text-foreground/80 hover:text-fdnda-primary hover:bg-muted"
                                            )}
                                        >
                                            <LayoutDashboard className="h-4 w-4" />Admin
                                        </Link>
                                    )}
                                    <div className="ml-2 flex items-center gap-1.5 pl-2 border-l border-border">
                                        <Link href="/mi-cuenta">
                                            <Button variant="ghost" size="sm" className="gap-2">
                                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white text-xs font-bold">
                                                    {(session.user?.name?.charAt(0) ?? "U").toUpperCase()}
                                                </span>
                                                <span className="max-w-[100px] truncate">{session.user?.name?.split(" ")[0]}</span>
                                            </Button>
                                        </Link>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => { clearCart(); signOut({ callbackUrl: "/" }) }}
                                            title="Cerrar sesión"
                                            aria-label="Cerrar sesión"
                                        >
                                            <LogOut className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </>
                            ) : (
                                <div className="flex items-center gap-2 ml-1">
                                    <Link href="/login"><Button variant="ghost" size="sm">Iniciar sesión</Button></Link>
                                    <Link href="/register"><Button variant="coral" size="sm" className="rounded-full px-4">Registrarse</Button></Link>
                                </div>
                            )}
                        </nav>

                        <button
                            className="md:hidden p-2 -mr-2 rounded-lg hover:bg-muted transition-colors"
                            onClick={() => setMobileMenuOpen(true)}
                            aria-label="Buscar"
                        >
                            <Search className="h-5 w-5 text-muted-foreground" />
                        </button>
                    </div>
                </div>

                {/* Scroll progress bar */}
                <motion.div
                    className="absolute bottom-0 left-0 right-0 h-0.5 origin-left bg-gradient-to-r from-fdnda-primary via-fdnda-accent to-coral"
                    style={{ scaleX }}
                />
            </header>

            {/* Mobile menu */}
            <AnimatePresence>
                {mobileMenuOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[9998] md:hidden"
                            onClick={() => setMobileMenuOpen(false)}
                        />
                        <motion.aside
                            variants={drawerVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            className="fixed top-0 left-0 h-full w-[min(320px,88vw)] bg-white z-[9999] md:hidden shadow-2xl flex flex-col"
                        >
                            <div className="flex items-center justify-between p-4 border-b border-border bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white">
                                <Link href="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
                                        <Image src="/logo.png" alt="FDNDA" width={32} height={32} className="h-8 w-8 object-contain" />
                                    </div>
                                    <div className="leading-tight">
                                        <span className="font-display font-bold text-lg block">FDNDA</span>
                                        <span className="text-xs text-white/80">Ticketing oficial</span>
                                    </div>
                                </Link>
                                <button
                                    className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                                    onClick={() => setMobileMenuOpen(false)}
                                    aria-label="Cerrar menú"
                                >
                                    <X className="h-5 w-5" />
                                </button>
                            </div>

                            <div className="p-4 border-b border-border">
                                <form onSubmit={handleSearch}>
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                        <Input
                                            type="text"
                                            placeholder="Buscar eventos..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="pl-9 w-full rounded-lg"
                                            autoFocus
                                        />
                                    </div>
                                </form>
                            </div>

                            {status === "authenticated" && session.user && (
                                <div className="p-4 border-b border-border bg-muted/30">
                                    <div className="flex items-center gap-3">
                                        <div className="h-11 w-11 rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary flex items-center justify-center text-white font-bold">
                                            {session.user.name?.charAt(0).toUpperCase() || "U"}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-foreground truncate">{session.user.name}</p>
                                            <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <motion.nav
                                variants={drawerListVariants}
                                initial="hidden"
                                animate="visible"
                                className="flex-1 overflow-y-auto py-3"
                            >
                                <div className="space-y-1 px-3">
                                    <motion.div variants={drawerItemVariants}>
                                        <DrawerLink
                                            href="/"
                                            label="Inicio"
                                            icon={Home}
                                            active={isActive("/")}
                                            onClick={() => setMobileMenuOpen(false)}
                                        />
                                    </motion.div>
                                    <motion.div variants={drawerItemVariants}>
                                        <DrawerLink
                                            href="/eventos"
                                            label="Eventos"
                                            icon={Calendar}
                                            active={startsWith("/eventos")}
                                            onClick={() => setMobileMenuOpen(false)}
                                        />
                                    </motion.div>

                                    {status === "authenticated" && (
                                        <>
                                            <DrawerSection
                                                id="account"
                                                label="Mi cuenta"
                                                openId={openSection}
                                                onToggle={setOpenSection}
                                            >
                                                <DrawerLink
                                                    href="/mi-cuenta"
                                                    label="Mi perfil"
                                                    icon={User}
                                                    active={isActive("/mi-cuenta")}
                                                    onClick={() => setMobileMenuOpen(false)}
                                                    chevron
                                                />
                                                <DrawerLink
                                                    href="/mi-cuenta/entradas"
                                                    label="Mis entradas"
                                                    icon={Ticket}
                                                    active={startsWith("/mi-cuenta/entradas")}
                                                    onClick={() => setMobileMenuOpen(false)}
                                                    chevron
                                                />
                                            </DrawerSection>

                                            {isStaff && (
                                                <DrawerSection
                                                    id="staff"
                                                    label="Staff"
                                                    openId={openSection}
                                                    onToggle={setOpenSection}
                                                >
                                                    <DrawerLink
                                                        href="/scanner"
                                                        label="Escáner QR"
                                                        icon={ScanLine}
                                                        active={startsWith("/scanner")}
                                                        onClick={() => setMobileMenuOpen(false)}
                                                        chevron
                                                    />
                                                </DrawerSection>
                                            )}

                                            {isAdmin && (
                                                <DrawerSection
                                                    id="admin"
                                                    label="Administración"
                                                    openId={openSection}
                                                    onToggle={setOpenSection}
                                                >
                                                    <DrawerLink
                                                        href="/admin"
                                                        label="Panel admin"
                                                        icon={LayoutDashboard}
                                                        active={startsWith("/admin")}
                                                        onClick={() => setMobileMenuOpen(false)}
                                                        chevron
                                                    />
                                                </DrawerSection>
                                            )}

                                            {isTreasury && (
                                                <DrawerSection
                                                    id="treasury"
                                                    label="Tesorería"
                                                    openId={openSection}
                                                    onToggle={setOpenSection}
                                                >
                                                    <DrawerLink
                                                        href="/tesoreria"
                                                        label="Panel tesorería"
                                                        icon={DollarSign}
                                                        active={startsWith("/tesoreria")}
                                                        onClick={() => setMobileMenuOpen(false)}
                                                        chevron
                                                    />
                                                </DrawerSection>
                                            )}
                                        </>
                                    )}
                                </div>
                            </motion.nav>

                            <div className="border-t border-border p-4 space-y-2">
                                {status === "authenticated" ? (
                                    <button
                                        className="flex items-center gap-3 w-full px-3 py-2.5 text-coral hover:bg-coral-soft rounded-lg transition-colors"
                                        onClick={() => { setMobileMenuOpen(false); clearCart(); signOut({ callbackUrl: "/" }) }}
                                    >
                                        <LogOut className="h-5 w-5" /><span className="font-medium">Cerrar sesión</span>
                                    </button>
                                ) : (
                                    <div className="space-y-2">
                                        <Link href="/login" className="block w-full" onClick={() => setMobileMenuOpen(false)}>
                                            <Button variant="outline" className="w-full">Iniciar sesión</Button>
                                        </Link>
                                        <Link href="/register" className="block w-full" onClick={() => setMobileMenuOpen(false)}>
                                            <Button variant="coral" className="w-full">Registrarse gratis</Button>
                                        </Link>
                                    </div>
                                )}
                                <a
                                    href="https://wa.me/51941632535"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-fdnda-primary transition-colors"
                                >
                                    <LifeBuoy className="h-4 w-4" />Soporte WhatsApp
                                </a>
                            </div>
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    )
}

function DrawerLink({
    href,
    label,
    icon: Icon,
    active,
    onClick,
    chevron = false,
}: {
    href: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    active?: boolean
    onClick?: () => void
    chevron?: boolean
}) {
    return (
        <Link
            href={href}
            className={cn(
                "flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors",
                active ? "bg-fdnda-primary text-white shadow-md" : "text-foreground/85 hover:bg-muted"
            )}
            onClick={onClick}
        >
            <div className="flex items-center gap-3">
                <Icon className={cn("h-5 w-5 flex-shrink-0", active ? "text-white" : "text-muted-foreground")} />
                <span className="font-medium text-sm">{label}</span>
            </div>
            {chevron && <ChevronRight className={cn("h-4 w-4", active ? "text-white/80" : "text-muted-foreground/60")} />}
        </Link>
    )
}

function DrawerSection({
    id,
    label,
    children,
    openId,
    onToggle,
}: {
    id: string
    label: string
    children: React.ReactNode
    openId: string | null
    onToggle: (id: string | null) => void
}) {
    const isOpen = openId === id
    return (
        <div className="pt-3">
            <button
                type="button"
                onClick={() => onToggle(isOpen ? null : id)}
                className="flex items-center justify-between w-full px-3 py-1.5 text-[11px] font-bold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
            >
                <span>{label}</span>
                <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform duration-300", isOpen ? "rotate-0" : "-rotate-90")}
                />
            </button>
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] as const }}
                        className="overflow-hidden"
                    >
                        <div className="space-y-1 pt-1">{children}</div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
