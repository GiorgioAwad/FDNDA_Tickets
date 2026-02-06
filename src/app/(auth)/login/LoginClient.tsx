"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Mail, Lock, AlertCircle } from "lucide-react"

export default function LoginClient() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const callbackUrl = searchParams.get("callbackUrl") || "/mi-cuenta"

    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError("")
        setLoading(true)

        try {
            const result = await signIn("credentials", {
                email,
                password,
                redirect: false,
            })

            if (result?.error) {
                setError("Email o contrase\u00f1a incorrectos")
            } else {
                router.push(callbackUrl)
                router.refresh()
            }
        } catch {
            setError("Error al iniciar sesi\u00f3n")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="min-h-[80vh] flex items-center justify-center py-12 px-4 bg-gradient-to-b from-gray-50 to-white">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-white shadow-sm ring-1 ring-black/5 mb-4">
                    <Image
                        src="/logo.png"
                        alt="FDNDA"
                        width={48}
                        height={48}
                        className="h-12 w-12 object-contain"
                        priority
                    />
                </div>
                    <h1 className="text-2xl font-bold text-gray-900">Ticketing FDNDA</h1>
                </div>

                <Card className="shadow-xl border-0">
                    <CardHeader className="text-center pb-0">
                        <CardTitle className="text-2xl">
                            {"Iniciar Sesi\u00f3n"}
                        </CardTitle>
                        <CardDescription>
                            Ingresa a tu cuenta para ver tus entradas
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="pt-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
                                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                                    {error}
                                </div>
                            )}

                            <div className="space-y-2">
                                <label htmlFor="email" className="text-sm font-medium text-gray-700">
                                    Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="tu@email.com"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="pl-10"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label htmlFor="password" className="text-sm font-medium text-gray-700">
                                        {"Contrase\u00f1a"}
                                    </label>
                                    <Link
                                        href="/forgot-password"
                                        className="text-sm text-[hsl(210,100%,40%)] hover:underline"
                                    >
                                        {"\u00bfOlvidaste tu contrase\u00f1a?"}
                                    </Link>
                                </div>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="********"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="pl-10"
                                        required
                                    />
                                </div>
                            </div>

                            <Button type="submit" className="w-full" size="lg" loading={loading}>
                                {"Iniciar Sesi\u00f3n"}
                            </Button>
                        </form>

                        <div className="mt-6 text-center text-sm text-gray-600">
                            {"\u00bfNo tienes cuenta?"}{" "}
                            <Link
                                href="/register"
                                className="font-semibold text-[hsl(210,100%,40%)] hover:underline"
                            >
                                {"Reg\u00edstrate gratis"}
                            </Link>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
