import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { User, Mail, Ticket } from "lucide-react"
import Link from "next/link"
import ProfileClient from "./ProfileClient"
export const dynamic = "force-dynamic"

export default async function MyAccountPage() {
    const user = await getCurrentUser()

    if (!user) {
        redirect("/login")
    }

    // Fetch stats
    const ticketCount = await prisma.ticket.count({
        where: { userId: user.id, status: "ACTIVE" },
    })

    const orderCount = await prisma.order.count({
        where: { userId: user.id },
    })

    return (
        <div className="container mx-auto px-4 py-12">
            <h1 className="text-3xl font-bold mb-8">Mi Cuenta</h1>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Sidebar */}
                <div className="space-y-4">
                    <Card>
                        <CardContent className="p-6 text-center">
                            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-100 text-blue-600 mb-4">
                                <User className="h-10 w-10" />
                            </div>
                            <h2 className="font-bold text-xl">{user.name}</h2>
                            <p className="text-gray-500 text-sm">{user.email}</p>

                            <div className="mt-4 pt-4 border-t flex items-center justify-center gap-2 text-sm text-gray-600">
                                <Mail className="h-4 w-4" />
                                {user.emailVerified ? (
                                    <span className="text-green-600 font-medium">Verificado</span>
                                ) : (
                                    <span className="text-amber-600 font-medium">No verificado</span>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <nav className="space-y-2">
                        <Link href="/mi-cuenta">
                            <Button variant="secondary" className="w-full justify-start">
                                <User className="h-4 w-4 mr-2" />
                                Perfil
                            </Button>
                        </Link>
                        <Link href="/mi-cuenta/entradas">
                            <Button variant="ghost" className="w-full justify-start">
                                <Ticket className="h-4 w-4 mr-2" />
                                Mis Entradas
                            </Button>
                        </Link>
                    </nav>
                </div>

                {/* Main Content */}
                <div className="md:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Card>
                            <CardContent className="p-6 flex items-center gap-4">
                                <div className="p-3 rounded-lg bg-blue-50 text-blue-600">
                                    <Ticket className="h-8 w-8" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold">{ticketCount}</div>
                                    <div className="text-sm text-gray-500">Entradas Activas</div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardContent className="p-6 flex items-center gap-4">
                                <div className="p-3 rounded-lg bg-green-50 text-green-600">
                                    <Ticket className="h-8 w-8" />
                                </div>
                                <div>
                                    <div className="text-2xl font-bold">{orderCount}</div>
                                    <div className="text-sm text-gray-500">Órdenes Totales</div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>

                    <ProfileClient
                        user={{
                            name: user.name ?? "",
                            email: user.email ?? "",
                            emailVerified: user.emailVerified ?? null,
                        }}
                    />
                    <Card>
                        <CardHeader>
                            <CardTitle>Acciones Rápidas</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <Link href="/mi-cuenta/entradas">
                                <Button className="w-full sm:w-auto">
                                    Ver mis entradas
                                </Button>
                            </Link>
                            <Link href="/eventos">
                                <Button variant="outline" className="w-full sm:w-auto ml-0 sm:ml-4">
                                    Buscar eventos
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}







