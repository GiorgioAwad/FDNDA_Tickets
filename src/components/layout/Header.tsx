"use client"

import Link from "next/link"
import Image from "next/image"
import { useSession, signOut } from "next-auth/react"
import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useCart } from "@/hooks/cart-context"
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
} from "lucide-react"

export function Header() {
    const { data: session, status } = useSession()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [isVisible, setIsVisible] = useState(true)
    const [lastScrollY, setLastScrollY] = useState(0)
    const { clearCart } = useCart()
    const router = useRouter()
    const pathname = usePathname()

    const isAdmin = session?.user?.role === "ADMIN"
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
        setMobileMenuOpen(false)
    }, [pathname])

    useEffect(() => {
        if (mobileMenuOpen) {
            document.body.style.overflow = 'hidden'
        } else {
            document.body.style.overflow = ''
        }
        return () => { document.body.style.overflow = '' }
    }, [mobileMenuOpen])

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault()
        if (searchTerm.trim()) {
            router.push("/eventos?search=" + encodeURIComponent(searchTerm.trim()))
            setSearchTerm("")
            setMobileMenuOpen(false)
        }
    }

    const isActive = (path: string) => pathname === path

    return (
        <>
            <header className={"sticky top-0 z-50 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 transition-transform duration-300 " + (isVisible ? "translate-y-0" : "-translate-y-full")}>
                <div className="container mx-auto px-4">
                    <div className="flex h-16 items-center justify-between gap-4">
                        <button className="md:hidden p-2 -ml-2 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(true)}>
                            <Menu className="h-6 w-6" />
                        </button>

                        <Link href="/" className="flex items-center gap-2 shrink-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5">
                                <Image src="/logo.png" alt="FDNDA" width={32} height={32} className="h-8 w-8 object-contain" priority />
                            </div>
                            <div className="hidden sm:block">
                                <span className="font-bold text-lg text-[hsl(210,100%,25%)]">FDNDA</span>
                                <span className="hidden lg:inline text-sm text-gray-500 ml-2">Tickets</span>
                            </div>
                        </Link>

                        <div className="hidden md:flex flex-1 justify-center max-w-2xl mx-4">
                            <form onSubmit={handleSearch} className="relative w-full">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input type="text" placeholder="Buscar eventos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-11 pr-4 w-full h-10 text-sm rounded-full border-gray-200" />
                            </form>
                        </div>

                        <nav className="hidden md:flex items-center gap-3 shrink-0">
                            <Link href="/eventos" className="text-sm font-medium text-gray-700 hover:text-[hsl(210,100%,25%)]">Eventos</Link>
                            {status === "authenticated" ? (
                                <>
                                    <Link href="/mi-cuenta/entradas" className="text-sm font-medium text-gray-700 hover:text-[hsl(210,100%,25%)] flex items-center gap-1">
                                        <Ticket className="h-4 w-4" />Mis Entradas
                                    </Link>
                                    {isStaff && <Link href="/scanner" className="text-sm font-medium text-gray-700 hover:text-[hsl(210,100%,25%)] flex items-center gap-1"><ScanLine className="h-4 w-4" />Escaner</Link>}
                                    {isAdmin && <Link href="/admin" className="text-sm font-medium text-gray-700 hover:text-[hsl(210,100%,25%)] flex items-center gap-1"><LayoutDashboard className="h-4 w-4" />Admin</Link>}
                                    <div className="flex items-center gap-2">
                                        <Link href="/mi-cuenta"><Button variant="ghost" size="sm" className="gap-2"><User className="h-4 w-4" />{session.user?.name?.split(" ")[0]}</Button></Link>
                                        <Button variant="ghost" size="icon" onClick={() => { clearCart(); signOut({ callbackUrl: "/" }) }} title="Cerrar sesion"><LogOut className="h-4 w-4" /></Button>
                                    </div>
                                </>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <Link href="/login"><Button variant="ghost" size="sm">Iniciar Sesion</Button></Link>
                                    <Link href="/register"><Button size="sm">Registrarse</Button></Link>
                                </div>
                            )}
                        </nav>

                        <button className="md:hidden p-2 -mr-2 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(true)}>
                            <Search className="h-5 w-5 text-gray-600" />
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile Menu Overlay - covers everything */}
            {mobileMenuOpen && (
                <div 
                    className="fixed inset-0 bg-black/60 z-[9998] md:hidden"
                    onClick={() => setMobileMenuOpen(false)} 
                />
            )}

            {/* Mobile Sidebar */}
            <aside 
                className={`fixed top-0 left-0 h-full w-[300px] bg-white z-[9999] md:hidden transform transition-transform duration-300 ease-out shadow-2xl ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
            >
                <div className="flex flex-col h-full">
                    <div className="flex items-center justify-between p-4 border-b">
                        <Link href="/" className="flex items-center gap-2" onClick={() => setMobileMenuOpen(false)}>
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-black/5">
                                <Image src="/logo.png" alt="FDNDA" width={32} height={32} className="h-8 w-8 object-contain" />
                            </div>
                            <div>
                                <span className="font-bold text-lg text-[hsl(210,100%,25%)]">FDNDA</span>
                                <span className="text-sm text-gray-500 ml-1">Tickets</span>
                            </div>
                        </Link>
                        <button className="p-2 hover:bg-gray-100 rounded-lg" onClick={() => setMobileMenuOpen(false)}><X className="h-5 w-5" /></button>
                    </div>

                    <div className="p-4 border-b">
                        <form onSubmit={handleSearch}>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <Input type="text" placeholder="Buscar eventos..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 w-full rounded-lg" />
                            </div>
                        </form>
                    </div>

                    {status === "authenticated" && session.user && (
                        <div className="p-4 border-b bg-gray-50">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-[hsl(210,100%,25%)] flex items-center justify-center text-white font-semibold">
                                    {session.user.name?.charAt(0).toUpperCase() || "U"}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-gray-900 truncate">{session.user.name}</p>
                                    <p className="text-sm text-gray-500 truncate">{session.user.email}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    <nav className="flex-1 overflow-y-auto py-4">
                        <div className="space-y-1 px-3">
                            <Link 
                                href="/" 
                                className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${isActive("/") ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-100"}`} 
                                onClick={() => setMobileMenuOpen(false)}
                            >
                                <Home className="h-5 w-5 flex-shrink-0" />
                                <span className="font-medium">Inicio</span>
                            </Link>
                            <Link 
                                href="/eventos" 
                                className={`flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${isActive("/eventos") ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-100"}`} 
                                onClick={() => setMobileMenuOpen(false)}
                            >
                                <Calendar className="h-5 w-5 flex-shrink-0" />
                                <span className="font-medium">Eventos</span>
                            </Link>

                            {status === "authenticated" && (
                                <>
                                    <div className="pt-4 pb-2 px-3">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Mi Cuenta</p>
                                    </div>
                                    <Link 
                                        href="/mi-cuenta" 
                                        className={`flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${isActive("/mi-cuenta") ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-100"}`} 
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <User className="h-5 w-5 flex-shrink-0" />
                                            <span className="font-medium">Mi Perfil</span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 opacity-50" />
                                    </Link>
                                    <Link 
                                        href="/mi-cuenta/entradas" 
                                        className={`flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${isActive("/mi-cuenta/entradas") ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-100"}`} 
                                        onClick={() => setMobileMenuOpen(false)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Ticket className="h-5 w-5 flex-shrink-0" />
                                            <span className="font-medium">Mis Entradas</span>
                                        </div>
                                        <ChevronRight className="h-4 w-4 opacity-50" />
                                    </Link>

                                    {isStaff && (
                                        <>
                                            <div className="pt-4 pb-2 px-3">
                                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Staff</p>
                                            </div>
                                            <Link 
                                                href="/scanner" 
                                                className={`flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${pathname.startsWith("/scanner") ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-100"}`} 
                                                onClick={() => setMobileMenuOpen(false)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <ScanLine className="h-5 w-5 flex-shrink-0" />
                                                    <span className="font-medium">Escaner QR</span>
                                                </div>
                                                <ChevronRight className="h-4 w-4 opacity-50" />
                                            </Link>
                                        </>
                                    )}

                                    {isAdmin && (
                                        <>
                                            <div className="pt-4 pb-2 px-3">
                                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Administracion</p>
                                            </div>
                                            <Link 
                                                href="/admin" 
                                                className={`flex items-center justify-between px-3 py-3 rounded-lg transition-colors ${pathname.startsWith("/admin") ? "bg-blue-600 text-white" : "text-gray-800 hover:bg-gray-100"}`} 
                                                onClick={() => setMobileMenuOpen(false)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <LayoutDashboard className="h-5 w-5 flex-shrink-0" />
                                                    <span className="font-medium">Panel Admin</span>
                                                </div>
                                                <ChevronRight className="h-4 w-4 opacity-50" />
                                            </Link>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </nav>

                    <div className="border-t p-4">
                        {status === "authenticated" ? (
                            <button className="flex items-center gap-3 w-full px-3 py-2.5 text-red-600 hover:bg-red-50 rounded-lg" onClick={() => { setMobileMenuOpen(false); clearCart(); signOut({ callbackUrl: "/" }) }}>
                                <LogOut className="h-5 w-5" /><span className="font-medium">Cerrar Sesion</span>
                            </button>
                        ) : (
                            <div className="space-y-2">
                                <Link href="/login" className="block w-full" onClick={() => setMobileMenuOpen(false)}><Button variant="outline" className="w-full">Iniciar Sesion</Button></Link>
                                <Link href="/register" className="block w-full" onClick={() => setMobileMenuOpen(false)}><Button className="w-full bg-[hsl(210,100%,25%)] hover:bg-[hsl(210,100%,20%)]">Registrarse</Button></Link>
                            </div>
                        )}
                    </div>
                </div>
            </aside>
        </>
    )
}
