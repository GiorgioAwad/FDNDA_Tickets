"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertCircle, CheckCircle2 } from "lucide-react"

type ComplaintFormState = {
    type: "RECLAMO" | "QUEJA"
    subjectType: "PRODUCTO" | "SERVICIO"
    consumerIsMinor: boolean
    parentName: string
    customerName: string
    documentType: "DNI" | "CE" | "PASAPORTE" | "RUC" | "OTRO"
    documentNumber: string
    email: string
    phone: string
    address: string
    orderId: string
    eventName: string
    subjectDescription: string
    amountClaimed: string
    detail: string
    requestDetail: string
    acceptedPolicy: boolean
}

const INITIAL_STATE: ComplaintFormState = {
    type: "RECLAMO",
    subjectType: "SERVICIO",
    consumerIsMinor: false,
    parentName: "",
    customerName: "",
    documentType: "DNI",
    documentNumber: "",
    email: "",
    phone: "",
    address: "",
    orderId: "",
    eventName: "",
    subjectDescription: "",
    amountClaimed: "",
    detail: "",
    requestDetail: "",
    acceptedPolicy: false,
}

export default function ComplaintBookForm() {
    const [form, setForm] = useState<ComplaintFormState>(INITIAL_STATE)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState("")
    const [ticketNumber, setTicketNumber] = useState("")

    const title = useMemo(
        () =>
            form.type === "RECLAMO"
                ? "Reclamo: disconformidad con el producto o servicio."
                : "Queja: malestar por la atencion o trato recibido.",
        [form.type]
    )

    const handleChange = (
        event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
    ) => {
        const target = event.target as HTMLInputElement
        const { name, value, type, checked } = target

        setForm((current) => ({
            ...current,
            [name]: type === "checkbox" ? checked : value,
        }))
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        setLoading(true)
        setError("")

        try {
            const response = await fetch("/api/libro-de-reclamaciones", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(form),
            })

            const data = await response.json()

            if (!response.ok || !data.success) {
                throw new Error(data.error || "No se pudo registrar tu solicitud.")
            }

            setTicketNumber(data.data.ticketNumber)
            setForm(INITIAL_STATE)
        } catch (submitError) {
            setError((submitError as Error).message)
        } finally {
            setLoading(false)
        }
    }

    if (ticketNumber) {
        return (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-6">
                <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 h-6 w-6 text-green-600" />
                    <div>
                        <h3 className="text-xl font-semibold text-green-900">
                            Solicitud registrada
                        </h3>
                        <p className="mt-2 text-sm text-green-800">
                            Tu hoja del Libro de Reclamaciones fue registrada correctamente.
                        </p>
                        <p className="mt-3 text-sm text-green-900">
                            <strong>Numero de constancia:</strong> {ticketNumber}
                        </p>
                        <p className="mt-2 text-sm text-green-800">
                            Hemos enviado un acuse al correo consignado. Conserva esta constancia.
                        </p>
                        <Button
                            className="mt-4"
                            onClick={() => {
                                setTicketNumber("")
                                setError("")
                            }}
                        >
                            Registrar otra solicitud
                        </Button>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-8">
            {error && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            <section className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Tipo</label>
                    <select
                        name="type"
                        value={form.type}
                        onChange={handleChange}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        <option value="RECLAMO">Reclamo</option>
                        <option value="QUEJA">Queja</option>
                    </select>
                    <p className="text-xs text-gray-500">{title}</p>
                </div>

                <div className="space-y-2">
                    <label className="text-sm font-medium text-gray-700">Bien o servicio</label>
                    <select
                        name="subjectType"
                        value={form.subjectType}
                        onChange={handleChange}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        <option value="PRODUCTO">Producto</option>
                        <option value="SERVICIO">Servicio</option>
                    </select>
                </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-gray-50 p-5">
                <h3 className="text-lg font-semibold text-gray-900">Datos del consumidor</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
                        <input
                            type="checkbox"
                            name="consumerIsMinor"
                            checked={form.consumerIsMinor}
                            onChange={handleChange}
                        />
                        El consumidor es menor de edad
                    </label>

                    {form.consumerIsMinor && (
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-sm font-medium text-gray-700">
                                Nombre del padre, madre o apoderado
                            </label>
                            <Input
                                name="parentName"
                                value={form.parentName}
                                onChange={handleChange}
                                required={form.consumerIsMinor}
                            />
                        </div>
                    )}

                    <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Nombres y apellidos</label>
                        <Input name="customerName" value={form.customerName} onChange={handleChange} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Tipo de documento</label>
                        <select
                            name="documentType"
                            value={form.documentType}
                            onChange={handleChange}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                            <option value="DNI">DNI</option>
                            <option value="CE">Carnet de extranjeria</option>
                            <option value="PASAPORTE">Pasaporte</option>
                            <option value="RUC">RUC</option>
                            <option value="OTRO">Otro</option>
                        </select>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Numero de documento</label>
                        <Input
                            name="documentNumber"
                            value={form.documentNumber}
                            onChange={handleChange}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Correo electronico</label>
                        <Input name="email" type="email" value={form.email} onChange={handleChange} required />
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Telefono</label>
                        <Input name="phone" value={form.phone} onChange={handleChange} />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Direccion</label>
                        <Input name="address" value={form.address} onChange={handleChange} required />
                    </div>
                </div>
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5">
                <h3 className="text-lg font-semibold text-gray-900">Detalle de la solicitud</h3>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Numero de pedido u operacion</label>
                        <Input name="orderId" value={form.orderId} onChange={handleChange} />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Evento o servicio vinculado</label>
                        <Input name="eventName" value={form.eventName} onChange={handleChange} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium text-gray-700">Producto o servicio reclamado</label>
                        <Input
                            name="subjectDescription"
                            value={form.subjectDescription}
                            onChange={handleChange}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Monto reclamado (opcional)</label>
                        <Input
                            name="amountClaimed"
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.amountClaimed}
                            onChange={handleChange}
                        />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                        <label className="text-sm font-medium text-gray-700">Detalle de los hechos</label>
                        <textarea
                            name="detail"
                            value={form.detail}
                            onChange={handleChange}
                            rows={6}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            required
                        />
                    </div>
                    <div className="md:col-span-2 space-y-2">
                        <label className="text-sm font-medium text-gray-700">Pedido del consumidor</label>
                        <textarea
                            name="requestDetail"
                            value={form.requestDetail}
                            onChange={handleChange}
                            rows={4}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            required
                        />
                    </div>
                </div>
            </section>

            <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
                <input
                    type="checkbox"
                    name="acceptedPolicy"
                    checked={form.acceptedPolicy}
                    onChange={handleChange}
                    className="mt-1"
                    required
                />
                <span>
                    Declaro que la informacion proporcionada es verdadera y autorizo su tratamiento para la atencion de esta hoja del Libro de Reclamaciones, conforme a la Politica de Privacidad publicada en este sitio.
                </span>
            </label>

            <Button type="submit" size="lg" loading={loading}>
                Registrar solicitud
            </Button>
        </form>
    )
}
