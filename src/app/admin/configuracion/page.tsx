"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { 
    Settings, 
    CreditCard,
    Mail,
    Shield,
    Bell,
    Palette,
    Save,
    CheckCircle,
    Info,
} from "lucide-react"

// Comisión de Izipay (3.99% + IGV)
const IZIPAY_COMMISSION_RATE = 0.0399
const IGV_RATE = 0.18
const TOTAL_COMMISSION_RATE = IZIPAY_COMMISSION_RATE * (1 + IGV_RATE)

export default function ConfiguracionPage() {
    const [saved, setSaved] = useState(false)

    const handleSave = () => {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
    }

    return (
        <div className="space-y-6">
            {/* Payment Gateway */}
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-blue-100">
                            <CreditCard className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <CardTitle>Pasarela de Pago</CardTitle>
                            <CardDescription>Configuración de Izipay</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex items-center justify-between p-4 rounded-lg bg-green-50 border border-green-100">
                        <div className="flex items-center gap-3">
                            <CheckCircle className="h-5 w-5 text-green-600" />
                            <div>
                                <p className="font-medium text-green-900">Izipay Conectado</p>
                                <p className="text-sm text-green-700">Procesador de pagos activo</p>
                            </div>
                        </div>
                        <Badge className="bg-green-100 text-green-700">Activo</Badge>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Shop ID</label>
                            <Input 
                                type="password"
                                value="••••••••••••"
                                disabled
                                className="bg-gray-50"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Key</label>
                            <Input 
                                type="password"
                                value="••••••••••••••••••••"
                                disabled
                                className="bg-gray-50"
                            />
                        </div>
                    </div>

                    <div className="p-4 rounded-lg bg-amber-50 border border-amber-100">
                        <div className="flex items-start gap-3">
                            <Info className="h-5 w-5 text-amber-600 mt-0.5" />
                            <div>
                                <p className="font-medium text-amber-900">Comisiones</p>
                                <ul className="text-sm text-amber-700 mt-1 space-y-1">
                                    <li>• Tasa base: <strong>3.99%</strong> por transacción</li>
                                    <li>• IGV sobre comisión: <strong>18%</strong></li>
                                    <li>• Comisión total efectiva: <strong>{(TOTAL_COMMISSION_RATE * 100).toFixed(2)}%</strong></li>
                                    <li>• Tu margen neto: <strong>{((1 - TOTAL_COMMISSION_RATE) * 100).toFixed(2)}%</strong></li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Email Settings */}
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-purple-100">
                            <Mail className="h-5 w-5 text-purple-600" />
                        </div>
                        <div>
                            <CardTitle>Configuración de Email</CardTitle>
                            <CardDescription>Notificaciones y correos automáticos</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Email de envío</label>
                            <Input 
                                type="email"
                                placeholder="noreply@fdnda.pe"
                                defaultValue="noreply@fdnda.pe"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Nombre de envío</label>
                            <Input 
                                placeholder="FDNDA Tickets"
                                defaultValue="FDNDA Tickets"
                            />
                        </div>
                    </div>

                    <div className="space-y-3">
                        <p className="text-sm font-medium text-gray-700">Notificaciones automáticas</p>
                        <div className="space-y-2">
                            {[
                                { label: "Confirmación de compra (al cliente)", enabled: true },
                                { label: "Recordatorio de evento (24h antes)", enabled: true },
                            ].map((item, i) => (
                                <div key={i} className="flex items-center justify-between p-3 rounded-lg border">
                                    <span className="text-sm">{item.label}</span>
                                    <Badge variant={item.enabled ? "default" : "outline"} className={item.enabled ? "hover:bg-primary" : "hover:bg-transparent"}>
                                        {item.enabled ? "Activo" : "Inactivo"}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Security */}
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-red-100">
                            <Shield className="h-5 w-5 text-red-600" />
                        </div>
                        <div>
                            <CardTitle>Seguridad</CardTitle>
                            <CardDescription>Sesiones y autenticación</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg bg-gray-50">
                            <p className="text-sm text-gray-500">Duración de sesión</p>
                            <p className="text-lg font-bold">7 días</p>
                            <p className="text-xs text-gray-400 mt-1">Con refresh cada 24h de actividad</p>
                        </div>
                        <div className="p-4 rounded-lg bg-gray-50">
                            <p className="text-sm text-gray-500">Verificación de email</p>
                            <p className="text-lg font-bold">Requerida</p>
                            <p className="text-xs text-gray-400 mt-1">Para comprar entradas</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* General */}
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-gray-100">
                            <Palette className="h-5 w-5 text-gray-600" />
                        </div>
                        <div>
                            <CardTitle>General</CardTitle>
                            <CardDescription>Configuración del sitio</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Nombre del sitio</label>
                            <Input 
                                placeholder="FDNDA Tickets"
                                defaultValue="FDNDA Tickets"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">Zona horaria</label>
                            <Input 
                                value="America/Lima (UTC-5)"
                                disabled
                                className="bg-gray-50"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Moneda predeterminada</label>
                        <Input 
                            value="PEN - Soles Peruanos"
                            disabled
                            className="bg-gray-50"
                        />
                    </div>
                </CardContent>
            </Card>

            {/* Save Button */}
            <div className="flex justify-end">
                <Button onClick={handleSave} className="gap-2">
                    {saved ? (
                        <>
                            <CheckCircle className="h-4 w-4" />
                            Guardado
                        </>
                    ) : (
                        <>
                            <Save className="h-4 w-4" />
                            Guardar Cambios
                        </>
                    )}
                </Button>
            </div>
        </div>
    )
}
