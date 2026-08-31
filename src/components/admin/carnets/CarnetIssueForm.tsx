"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarDays, ListChecks, Loader2, PenLine, User } from "lucide-react"

import {
    CarnetDetailFields,
    type CarnetTicketTypeOption,
    type DateCapacityRow,
} from "./CarnetDetailFields"
import { UserPicker, type CarnetUser } from "./UserPicker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import type { MembershipScheduleInput } from "@/lib/membership-schedule"
import { formatPrice } from "@/lib/utils"

type CarnetOptionEvent = {
    id: string
    title: string
    category: string
    servilexSucursalCode: string
    startDate: string
    endDate: string
    membershipStartFixed: string | null
    membershipStartMin: string | null
    membershipStartMax: string | null
    ticketTypes: CarnetTicketTypeOption[]
}

/** Forma cruda de CarnetPlan que devuelve el servidor (solo los campos que esta UI usa). */
type CarnetPlanResponse = {
    sourceRef: string
    attendeeName: string
    attendeeDni: string | null
    ticketTypeName: string
    eventTitle: string
    entitlementDates: string[]
    /** Por que entitlementDates puede venir vacio (ver CarnetPlan.entitlementMode). */
    entitlementMode: "MONTHLY_CLASS" | "POOL_BAG" | "DATES"
    capacityBefore: number
    capacityTotal: number
    warnings: string[]
    membershipStartDate: string | null
    forcedGlobalCapacity: boolean
    forcedDateCapacity: boolean
}

/**
 * Lo que de verdad se emitio, capturado del `plan` en el instante en que
 * onIssue confirma la firma y dispara el POST -- antes de esperar la
 * respuesta. Si el admin edita el formulario mientras la solicitud esta en
 * vuelo, este snapshot no se ve afectado: el banner de exito describe lo que
 * se emitio, no lo que el formulario muestra quince segundos despues.
 */
type IssuedSnapshot = {
    attendeeName: string
    attendeeDni: string | null
    ticketTypeName: string
    eventTitle: string
}

type CarnetPlanPreview = CarnetPlanResponse & {
    /**
     * Firma (JSON) del cuerpo de la solicitud que genero este plan, sin
     * sourceRef. onIssue la recalcula al momento de emitir y la compara: si
     * algo cambio despues del preview, la emision se bloquea en vez de mandar
     * un sourceRef que ya no corresponde a los datos actuales. Doble barrera:
     * cada campo ya limpia `plan` en su propio manejador (ver resetPreview),
     * esto es la segunda linea de defensa por si algun campo quedara mal
     * cableado.
     */
    requestSignature: string
}

const selectClassName =
    "w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

const checkboxClassName = "h-4 w-4 rounded border-input text-primary focus:ring-ring"

/**
 * Extrae mensajes de error de una respuesta JSON de la API. El sobre de
 * error NO es uniforme entre rutas: options/pool-dates devuelven
 * `{ error: string }`, preview/emitir devuelven `{ errors: string[] }`.
 * Sin esto, la mitad de los fallos reales renderiaria blanco o "undefined".
 */
function extractErrors(json: unknown): string[] {
    const body = json as { errors?: unknown; error?: unknown } | null | undefined
    if (Array.isArray(body?.errors)) {
        const strings = body.errors.filter((item): item is string => typeof item === "string")
        if (strings.length > 0) return strings
    }
    if (typeof body?.error === "string" && body.error) return [body.error]
    return ["Error inesperado"]
}

type CarnetIssueFormProps = {
    /**
     * Se llama despues de cada emision confirmada. Lo usa CarnetsPanel para
     * refrescar el historial: los dos componentes son hermanos y sin este
     * aviso la tabla se quedaba con la foto de la carga inicial, aunque su
     * estado vacio promete que lo emitido "va a aparecer aqui".
     */
    onIssued?: () => void
}

export function CarnetIssueForm({ onIssued }: CarnetIssueFormProps = {}) {
    const [events, setEvents] = useState<CarnetOptionEvent[]>([])
    const [includeEnded, setIncludeEnded] = useState(false)
    const [loadingEvents, setLoadingEvents] = useState(true)

    const [user, setUser] = useState<CarnetUser | null>(null)
    const [eventId, setEventId] = useState("")
    const [ticketTypeId, setTicketTypeId] = useState("")

    const [startDate, setStartDate] = useState("")
    const [schedule, setSchedule] = useState<MembershipScheduleInput>({})
    const [dateInventory, setDateInventory] = useState<DateCapacityRow[]>([])
    const [loadingDates, setLoadingDates] = useState(false)
    const [selectedDates, setSelectedDates] = useState<string[]>([])

    const [attendeeName, setAttendeeName] = useState("")
    const [attendeeDni, setAttendeeDni] = useState("")
    const [amountPaid, setAmountPaid] = useState("0")
    const [reason, setReason] = useState("")
    const [sendEmail, setSendEmail] = useState(true)
    const [forceCapacity, setForceCapacity] = useState(false)
    const [allowExistingActive, setAllowExistingActive] = useState(false)

    const [plan, setPlan] = useState<CarnetPlanPreview | null>(null)
    const [errors, setErrors] = useState<string[]>([])
    const [busy, setBusy] = useState<"preview" | "issue" | null>(null)
    const [issued, setIssued] = useState<
        (IssuedSnapshot & { ticketCode: string; emailError: string | null }) | null
    >(null)

    // El evento/tipo de entrada seleccionados se DERIVAN del catalogo en cada
    // render en vez de guardarse aparte: si el catalogo cambia (p. ej. se
    // desmarca "mostrar finalizados" y el evento elegido ya no esta) la
    // seleccion queda huerfana sola, sin necesitar un efecto dedicado a
    // "limpiarla".
    const event = useMemo(() => events.find((e) => e.id === eventId) ?? null, [events, eventId])
    const ticketType = useMemo(
        () => event?.ticketTypes.find((t) => t.id === ticketTypeId) ?? null,
        [event, ticketTypeId]
    )
    // Un preview calculado deja de ser valido en cuanto cambia cualquier
    // campo que viaja en el cuerpo de la solicitud (o el usuario/tipo de
    // entrada que lo determinan). Se limpia desde el propio manejador de
    // cada campo (ver los handle* de abajo) y no con un efecto que "reacciona"
    // al cambio: asi la invalidacion ocurre en el MISMO render que el cambio,
    // sin ninguna ventana intermedia donde un plan viejo pueda verse vigente.
    const resetPreview = () => {
        setPlan(null)
        setIssued(null)
        setErrors([])
    }

    // Catalogo de eventos/tipos de entrada.
    useEffect(() => {
        let cancelled = false
        // eslint-disable-next-line react-hooks/set-state-in-effect -- senaliza que la carga empezo; se apaga en el finally de la misma solicitud
        setLoadingEvents(true)
        fetch(`/api/admin/carnets/options?includeEnded=${includeEnded}`)
            .then((r) => r.json())
            .then((json) => {
                if (cancelled) return
                if (json?.success) {
                    setEvents(json.data.events)
                } else {
                    setEvents([])
                    setErrors(extractErrors(json))
                }
            })
            .catch(() => {
                if (cancelled) return
                setEvents([])
                setErrors(["No se pudieron cargar los eventos. Revisa tu conexion."])
            })
            .finally(() => {
                if (!cancelled) setLoadingEvents(false)
            })
        return () => {
            cancelled = true
        }
    }, [includeEnded])

    // Cupo por fecha: se consulta para cualquier tipo con usesDateCapacity, no
    // solo piscina libre (correccion del brief original). dateInventory ya
    // quedo en [] por handleTicketTypeChange cuando cambio la seleccion, asi
    // que este efecto solo necesita ocuparse de traer datos nuevos -- nunca
    // de limpiar el caso en que no aplica.
    useEffect(() => {
        if (!ticketTypeId || !ticketType?.usesDateCapacity) return
        let cancelled = false
        // eslint-disable-next-line react-hooks/set-state-in-effect -- senaliza que la carga empezo; se apaga en el finally de la misma solicitud
        setLoadingDates(true)
        fetch(`/api/admin/carnets/pool-dates?ticketTypeId=${ticketTypeId}`)
            .then((r) => r.json())
            .then((json) => {
                if (cancelled) return
                if (json?.success) {
                    setDateInventory(json.data.dates)
                } else {
                    setDateInventory([])
                    setErrors(extractErrors(json))
                }
            })
            .catch(() => {
                if (cancelled) return
                setDateInventory([])
                setErrors(["No se pudieron cargar las fechas disponibles. Revisa tu conexion."])
            })
            .finally(() => {
                if (!cancelled) setLoadingDates(false)
            })
        return () => {
            cancelled = true
        }
    }, [ticketTypeId, ticketType?.usesDateCapacity])

    // ── Manejadores: cada uno actualiza su campo Y invalida el preview en el
    // mismo evento (nunca via un efecto separado). Los que cambian de evento o
    // tipo de entrada tambien limpian los campos de detalle que dependen de
    // la seleccion anterior (fecha, horario, inicio de membresia): son datos
    // propios del tipo de entrada saliente, no deben sobrevivir el cambio. ──
    const handleUserChange = (next: CarnetUser | null) => {
        setUser(next)
        resetPreview()
    }

    const handleEventChange = (id: string) => {
        setEventId(id)
        setTicketTypeId("")
        setSelectedDates([])
        setStartDate("")
        setSchedule({})
        setDateInventory([])
        resetPreview()
    }

    const handleTicketTypeChange = (id: string) => {
        setTicketTypeId(id)
        setSelectedDates([])
        setStartDate("")
        setSchedule({})
        setDateInventory([])
        resetPreview()
    }

    const handleStartDateChange = (value: string) => {
        setStartDate(value)
        resetPreview()
    }
    const handleScheduleChange = (value: MembershipScheduleInput) => {
        setSchedule(value)
        resetPreview()
    }
    const handleSelectedDatesChange = (value: string[]) => {
        setSelectedDates(value)
        resetPreview()
    }
    const handleAttendeeNameChange = (value: string) => {
        setAttendeeName(value)
        resetPreview()
    }
    const handleAttendeeDniChange = (value: string) => {
        setAttendeeDni(value)
        resetPreview()
    }
    const handleAmountPaidChange = (value: string) => {
        setAmountPaid(value)
        resetPreview()
    }
    const handleReasonChange = (value: string) => {
        setReason(value)
        resetPreview()
    }
    const handleSendEmailChange = (value: boolean) => {
        setSendEmail(value)
        resetPreview()
    }
    const handleForceCapacityChange = (value: boolean) => {
        setForceCapacity(value)
        resetPreview()
    }
    const handleAllowExistingActiveChange = (value: boolean) => {
        setAllowExistingActive(value)
        resetPreview()
    }

    const buildBody = (sourceRef?: string) => ({
        userId: user?.id,
        ticketTypeId,
        attendeeName: attendeeName.trim() || undefined,
        attendeeDni: attendeeDni.trim() || undefined,
        amountPaid: Number(amountPaid) || 0,
        membershipStartDate: startDate || undefined,
        membershipSchedule: ticketType?.scheduleProfile ? schedule : undefined,
        scheduleSelections: selectedDates.map((date) => ({ date })),
        reason,
        sendEmail,
        forceCapacity,
        allowExistingActive,
        ...(sourceRef ? { sourceRef } : {}),
    })

    const post = async <T,>(url: string, sourceRef?: string): Promise<T | null> => {
        setErrors([])
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildBody(sourceRef)),
            })
            const json = await res.json()
            if (!json?.success) {
                setErrors(extractErrors(json))
                return null
            }
            return json.data as T
        } catch (error) {
            // error.message del browser (p. ej. "Failed to fetch") es texto en
            // ingles: nunca se muestra tal cual, solo se deja en consola para
            // diagnostico. Mismo criterio que los otros dos catch de fetch de
            // este componente (carga de eventos / fechas disponibles).
            console.error("Error de red en el panel de carnets:", error)
            setErrors(["No se pudo conectar con el servidor. Revisa tu conexion e intenta de nuevo."])
            return null
        }
    }

    const onPreview = async () => {
        setBusy("preview")
        // Capturada ANTES del fetch: es la firma de lo que se esta previsualizando.
        const requestSignature = JSON.stringify(buildBody())
        const data = await post<{ plan: CarnetPlanResponse }>("/api/admin/carnets/preview")
        if (data) {
            // Si el formulario cambio mientras la solicitud estaba en vuelo,
            // este preview ya no corresponde a lo que se ve en pantalla: se
            // descarta en silencio en vez de mostrar una tarjeta que no
            // coincide con los campos actuales (el admin puede volver a
            // previsualizar).
            if (JSON.stringify(buildBody()) === requestSignature) {
                setPlan({ ...data.plan, requestSignature })
            }
        }
        setBusy(null)
    }

    const onIssue = async () => {
        if (!plan) return
        // Segunda barrera contra un sourceRef desactualizado (ver comentario
        // en CarnetPlanPreview): si el cuerpo actual ya no coincide con el
        // que genero este plan, no se emite -- se pide previsualizar de nuevo.
        if (JSON.stringify(buildBody()) !== plan.requestSignature) {
            setPlan(null)
            setErrors(["Los datos cambiaron despues de previsualizar. Vuelve a previsualizar antes de emitir."])
            return
        }
        // Snapshot de lo que se esta emitiendo, tomado del `plan` en este
        // mismo instante -- antes de esperar la respuesta. El formulario
        // sigue editable mientras la solicitud esta en vuelo (solo los
        // botones se deshabilitan), asi que si el admin corrige un campo
        // (p. ej. el DNI) antes de que llegue la respuesta, este objeto local
        // NO cambia con el: sigue describiendo exactamente lo que se envio.
        const issuedSnapshot: IssuedSnapshot = {
            attendeeName: plan.attendeeName,
            attendeeDni: plan.attendeeDni,
            ticketTypeName: plan.ticketTypeName,
            eventTitle: plan.eventTitle,
        }
        setBusy("issue")
        const data = await post<{ ticketCode: string; emailError: string | null }>(
            "/api/admin/carnets",
            plan.sourceRef
        )
        if (data) {
            // Se arma con issuedSnapshot (capturado arriba), no con el estado
            // vivo del formulario: si este ya cambio mientras se esperaba la
            // respuesta, el banner sigue describiendo lo que de verdad se
            // emitio, no lo que hay ahora en pantalla.
            setIssued({ ...issuedSnapshot, ticketCode: data.ticketCode, emailError: data.emailError })
            setPlan(null)
            onIssued?.()
        }
        setBusy(null)
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <User className="h-5 w-5 text-muted-foreground" />
                        1 · Usuario
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <UserPicker value={user} onChange={handleUserChange} />
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <CalendarDays className="h-5 w-5 text-muted-foreground" />
                        2 · Evento y tipo de entrada
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input
                            type="checkbox"
                            checked={includeEnded}
                            onChange={(e) => setIncludeEnded(e.target.checked)}
                            className={checkboxClassName}
                        />
                        Mostrar eventos finalizados
                    </label>

                    {loadingEvents ? (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Cargando eventos...
                        </p>
                    ) : (
                        <select
                            value={event ? eventId : ""}
                            onChange={(e) => handleEventChange(e.target.value)}
                            className={selectClassName}
                        >
                            <option value="">Elige un evento</option>
                            {events.map((e) => (
                                <option key={e.id} value={e.id}>
                                    {e.title}
                                </option>
                            ))}
                        </select>
                    )}

                    {event && (
                        <select
                            value={ticketType ? ticketTypeId : ""}
                            onChange={(e) => handleTicketTypeChange(e.target.value)}
                            className={selectClassName}
                        >
                            <option value="">Elige un tipo de entrada</option>
                            {event.ticketTypes.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.name} — {t.sold}/{t.capacity || "∞"} — {formatPrice(t.price)}
                                </option>
                            ))}
                        </select>
                    )}
                </CardContent>
            </Card>

            {ticketType && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <ListChecks className="h-5 w-5 text-muted-foreground" />
                            3 · Detalle
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loadingDates && (
                            <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Cargando fechas disponibles...
                            </p>
                        )}
                        <CarnetDetailFields
                            ticketType={ticketType}
                            eventCategory={event?.category ?? null}
                            membershipStartFixed={event?.membershipStartFixed ?? null}
                            startDate={startDate}
                            setStartDate={handleStartDateChange}
                            schedule={schedule}
                            setSchedule={handleScheduleChange}
                            dateInventory={dateInventory}
                            selectedDates={selectedDates}
                            setSelectedDates={handleSelectedDatesChange}
                        />
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <PenLine className="h-5 w-5 text-muted-foreground" />
                        4 · Datos del carnet
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-foreground">Nombre del asistente</label>
                            <Input
                                value={attendeeName}
                                onChange={(e) => handleAttendeeNameChange(e.target.value)}
                                placeholder={user?.name ?? "Nombre del asistente"}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-foreground">DNI</label>
                            <Input
                                value={attendeeDni}
                                onChange={(e) => handleAttendeeDniChange(e.target.value)}
                                placeholder="DNI"
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-sm font-medium text-foreground">Monto pagado (S/)</label>
                            <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={amountPaid}
                                onChange={(e) => handleAmountPaidChange(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-sm font-medium text-foreground">
                            Motivo de la emision (obligatorio)
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => handleReasonChange(e.target.value)}
                            placeholder="Ej: regularizacion de carnet presencial, cortesia especial, etc."
                            rows={2}
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                    </div>

                    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-foreground">
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={sendEmail}
                                onChange={(e) => handleSendEmailChange(e.target.checked)}
                                className={checkboxClassName}
                            />
                            Enviar correo al titular
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={forceCapacity}
                                onChange={(e) => handleForceCapacityChange(e.target.checked)}
                                className={checkboxClassName}
                            />
                            Forzar sobrecupo
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={allowExistingActive}
                                onChange={(e) => handleAllowExistingActiveChange(e.target.checked)}
                                className={checkboxClassName}
                            />
                            Permitir duplicado (el usuario ya tiene un carnet activo)
                        </label>
                    </div>
                </CardContent>
            </Card>

            {errors.length > 0 && (
                <Card className="border-destructive/40 bg-destructive/5">
                    <CardContent className="space-y-1 p-4 text-sm text-destructive">
                        {errors.map((error, index) => (
                            <p key={`${index}-${error}`}>• {error}</p>
                        ))}
                    </CardContent>
                </Card>
            )}

            {plan && (
                <Card className="border-sky-200 bg-sky-50">
                    <CardContent className="space-y-2 p-4 text-sm text-sky-900">
                        <div className="flex items-center justify-between">
                            <p className="font-semibold">Se va a emitir</p>
                            {(plan.forcedGlobalCapacity || plan.forcedDateCapacity) && (
                                <Badge variant="warning">Sobrecupo</Badge>
                            )}
                        </div>
                        <p>
                            {plan.attendeeName} — {plan.ticketTypeName} ({plan.eventTitle})
                        </p>
                        {plan.membershipStartDate && <p>Inicio de membresia: {plan.membershipStartDate}</p>}
                        {/* entitlementDates vacio significa cosas distintas segun
                            el tipo de entrada: una bolsa de piscina reserva sus
                            visitas despues, una membresia crea el entitlement de
                            cada clase al escanear. Se distingue por
                            entitlementMode, que resuelve el servidor. */}
                        <p>
                            Dias validos:{" "}
                            {plan.entitlementDates.length > 0
                                ? `${plan.entitlementDates.length} (${plan.entitlementDates[0]} → ${
                                      plan.entitlementDates[plan.entitlementDates.length - 1]
                                  })`
                                : plan.entitlementMode === "POOL_BAG"
                                  ? "sin fechas: las visitas se reservan despues, una por una"
                                  : plan.entitlementMode === "MONTHLY_CLASS"
                                    ? "por clase (cupo mensual)"
                                    : "sin fechas"}
                        </p>
                        <p>
                            Cupo: {plan.capacityBefore} → {plan.capacityBefore + 1} de {plan.capacityTotal || "∞"}
                        </p>
                        {plan.warnings.map((warning) => (
                            <p key={warning} className="font-medium text-amber-700">
                                ⚠ {warning}
                            </p>
                        ))}
                    </CardContent>
                </Card>
            )}

            {issued && (
                <Card className="border-green-200 bg-green-50">
                    <CardContent className="space-y-1 p-4 text-sm text-green-900">
                        <div className="flex items-center gap-2">
                            <Badge variant="success">Emitido</Badge>
                            <p className="font-semibold">Carnet {issued.ticketCode}</p>
                        </div>
                        {/* Datos capturados al momento de emitir (issuedSnapshot), no el
                            estado actual del formulario: si se edito algo mientras la
                            solicitud estaba en vuelo, esto sigue describiendo lo que
                            de verdad se emitio. */}
                        <p>
                            {issued.attendeeName}
                            {issued.attendeeDni ? ` (DNI ${issued.attendeeDni})` : ""} — {issued.ticketTypeName}
                            , {issued.eventTitle}
                        </p>
                        {issued.emailError && (
                            <p className="text-amber-700">El correo no se pudo enviar: {issued.emailError}</p>
                        )}
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-wrap gap-3">
                <Button
                    type="button"
                    onClick={onPreview}
                    disabled={busy !== null || !user || !ticketTypeId}
                    className="gap-2"
                >
                    {busy === "preview" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {busy === "preview" ? "Previsualizando..." : "Previsualizar"}
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    onClick={onIssue}
                    disabled={busy !== null || !plan}
                    className="gap-2"
                >
                    {busy === "issue" && <Loader2 className="h-4 w-4 animate-spin" />}
                    {busy === "issue" ? "Emitiendo..." : "Emitir carnet"}
                </Button>
            </div>
        </div>
    )
}
