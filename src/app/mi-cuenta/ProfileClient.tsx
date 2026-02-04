"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, CheckCircle } from "lucide-react"

interface ProfileClientProps {
    user: {
        name: string
        email: string
        emailVerified: Date | null
    }
}

export default function ProfileClient({ user }: ProfileClientProps) {
    const [name, setName] = useState(user.name)
    const [email, setEmail] = useState(user.email)
    const [profileLoading, setProfileLoading] = useState(false)
    const [profileError, setProfileError] = useState("")
    const [profileSuccess, setProfileSuccess] = useState("")

    const [currentPassword, setCurrentPassword] = useState("")
    const [newPassword, setNewPassword] = useState("")
    const [confirmPassword, setConfirmPassword] = useState("")
    const [passwordLoading, setPasswordLoading] = useState(false)
    const [passwordError, setPasswordError] = useState("")
    const [passwordSuccess, setPasswordSuccess] = useState("")

    const handleProfileSave = async () => {
        setProfileLoading(true)
        setProfileError("")
        setProfileSuccess("")
        try {
            const response = await fetch("/api/account/profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, email }),
            })
            const data = await response.json()
            if (!response.ok) {
                throw new Error(data.error || "Error al actualizar perfil")
            }
            if (data.warning) {
                setProfileSuccess(`Perfil actualizado. ${data.warning}`)
            } else if (data.verificationSent) {
                setProfileSuccess("Perfil actualizado. Revisa tu correo para verificar el nuevo email.")
            } else {
                setProfileSuccess("Perfil actualizado correctamente.")
            }
        } catch (err) {
            setProfileError((err as Error).message)
        } finally {
            setProfileLoading(false)
        }
    }

    const handlePasswordSave = async () => {
        setPasswordLoading(true)
        setPasswordError("")
        setPasswordSuccess("")
        try {
            const response = await fetch("/api/account/password", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    currentPassword,
                    newPassword,
                    confirmPassword,
                }),
            })
            const data = await response.json()
            if (!response.ok) {
                throw new Error(data.error || "Error al actualizar contraseña")
            }
            setPasswordSuccess("Contraseña actualizada correctamente.")
            setCurrentPassword("")
            setNewPassword("")
            setConfirmPassword("")
        } catch (err) {
            setPasswordError((err as Error).message)
        } finally {
            setPasswordLoading(false)
        }
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Datos del perfil</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {profileError && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                            {profileError}
                        </div>
                    )}
                    {profileSuccess && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 text-green-700 text-sm">
                            <CheckCircle className="h-4 w-4 flex-shrink-0" />
                            {profileSuccess}
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Nombre</label>
                            <Input value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Email</label>
                            <Input value={email} onChange={(e) => setEmail(e.target.value)} />
                        </div>
                    </div>
                    <div>
                        <Button onClick={handleProfileSave} loading={profileLoading}>
                            Guardar cambios
                        </Button>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Cambiar contraseña</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {passwordError && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
                            <AlertCircle className="h-4 w-4 flex-shrink-0" />
                            {passwordError}
                        </div>
                    )}
                    {passwordSuccess && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 text-green-700 text-sm">
                            <CheckCircle className="h-4 w-4 flex-shrink-0" />
                            {passwordSuccess}
                        </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Contraseña actual</label>
                            <Input
                                type="password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Nueva contraseña</label>
                            <Input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium">Confirmar contraseña</label>
                            <Input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>
                    </div>
                    <div>
                        <Button onClick={handlePasswordSave} loading={passwordLoading}>
                            Actualizar contraseña
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </>
    )
}



