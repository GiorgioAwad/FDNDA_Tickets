"use client"

import { useEffect, useMemo, useState } from "react"

type ServiceOption = {
    id: string
    sucursalCodigo: string
    servicioCodigo: string
    servicioDescripcion: string
}

type DisciplineOption = {
    id: string
    disciplinaCodigo: string
    disciplinaNombre: string
}

type ScheduleOption = {
    id: string
    disciplinaCodigo: string
    horarioCodigo: string
    diaDescripcion: string
    horaInicio: string | null
    horaFin: string | null
    duracionHoras: number | null
}

type BindingOption = {
    id: string
    sucursalCodigo: string
    servicioCodigo: string
    disciplinaCodigo: string
    piscinaCodigo: string
    horarioCodigo: string
    numeroCupos: number
    serviceDescription?: string | null
    disciplineName?: string | null
    scheduleDescription?: string | null
    horaInicio?: string | null
    horaFin?: string | null
    duracionHoras?: number | null
}

interface AbioBindingSelectorProps {
    indicator: string
    sucursalCode: string
    serviceCode: string
    disciplineCode: string
    scheduleCode: string
    poolCode: string
    bindingId: string | null
    onPatch: (
        patch: Partial<{
            servilexSucursalCode: string
            servilexServiceCode: string
            servilexDisciplineCode: string
            servilexScheduleCode: string
            servilexPoolCode: string
            servilexBindingId: string | null
            capacity: number
            servilexExtraConfig: Record<string, unknown>
        }>
    ) => void
}

export function AbioBindingSelector(props: AbioBindingSelectorProps) {
    const [services, setServices] = useState<ServiceOption[]>([])
    const [disciplines, setDisciplines] = useState<DisciplineOption[]>([])
    const [schedules, setSchedules] = useState<ScheduleOption[]>([])
    const [bindings, setBindings] = useState<BindingOption[]>([])
    const [loadingBindings, setLoadingBindings] = useState(false)

    const usesStructuredCatalog =
        props.indicator === "AC" || props.indicator === "PN" || props.indicator === "PA"

    useEffect(() => {
        if (!props.sucursalCode) {
            setServices([])
            return
        }

        void fetch(`/api/admin/abio-catalog/services?sucursal=${encodeURIComponent(props.sucursalCode)}`, {
            cache: "no-store",
        })
            .then((res) => res.json())
            .then((payload) => setServices(payload.data || []))
            .catch((error) => console.error("Error loading ABIO services", error))
    }, [props.sucursalCode])

    useEffect(() => {
        if (!usesStructuredCatalog) {
            setDisciplines([])
            return
        }

        void fetch("/api/admin/abio-catalog/disciplines", {
            cache: "no-store",
        })
            .then((res) => res.json())
            .then((payload) => setDisciplines(payload.data || []))
            .catch((error) => console.error("Error loading ABIO disciplines", error))
    }, [usesStructuredCatalog])

    useEffect(() => {
        if (!usesStructuredCatalog || !props.disciplineCode) {
            setSchedules([])
            return
        }

        void fetch(
            `/api/admin/abio-catalog/schedules?disciplina=${encodeURIComponent(props.disciplineCode)}`,
            { cache: "no-store" }
        )
            .then((res) => res.json())
            .then((payload) => setSchedules(payload.data || []))
            .catch((error) => console.error("Error loading ABIO schedules", error))
    }, [usesStructuredCatalog, props.disciplineCode])

    useEffect(() => {
        if (!usesStructuredCatalog || !props.sucursalCode || !props.serviceCode) {
            setBindings([])
            return
        }

        const query = new URLSearchParams({
            sucursal: props.sucursalCode,
            servicio: props.serviceCode,
        })
        if (props.disciplineCode) query.set("disciplina", props.disciplineCode)
        if (props.scheduleCode) query.set("horario", props.scheduleCode)
        if (props.poolCode) query.set("piscina", props.poolCode)

        setLoadingBindings(true)
        void fetch(`/api/admin/abio-catalog/bindings?${query.toString()}`, {
            cache: "no-store",
        })
            .then((res) => res.json())
            .then((payload) => setBindings(payload.data || []))
            .catch((error) => console.error("Error loading optional ABIO bindings", error))
            .finally(() => setLoadingBindings(false))
    }, [
        usesStructuredCatalog,
        props.sucursalCode,
        props.serviceCode,
        props.disciplineCode,
        props.scheduleCode,
        props.poolCode,
    ])

    const selectedService = useMemo(
        () => services.find((item) => item.servicioCodigo === props.serviceCode) || null,
        [services, props.serviceCode]
    )

    const selectedBinding = useMemo(
        () => bindings.find((item) => item.id === props.bindingId) || null,
        [bindings, props.bindingId]
    )

    const applyBinding = (binding: BindingOption | null) => {
        if (!binding) {
            props.onPatch({ servilexBindingId: null })
            return
        }

        const extraConfigPatch =
            props.indicator === "PN" || props.indicator === "PA"
                ? {
                      cantidad: 1,
                      horaInicio: binding.horaInicio || "",
                      horaFin: binding.horaFin || "",
                      duracion:
                          binding.duracionHoras !== null && binding.duracionHoras !== undefined
                              ? binding.duracionHoras
                              : 1,
                  }
                : undefined

        props.onPatch({
            servilexBindingId: binding.id,
            servilexSucursalCode: binding.sucursalCodigo,
            servilexServiceCode: binding.servicioCodigo,
            servilexDisciplineCode: binding.disciplinaCodigo,
            servilexScheduleCode: binding.horarioCodigo,
            servilexPoolCode: binding.piscinaCodigo,
            ...(extraConfigPatch ? { servilexExtraConfig: extraConfigPatch } : {}),
        })
    }

    return (
        <div className="space-y-4 rounded-md border border-dashed bg-gray-50 p-4">
            <div className="space-y-1">
                <p className="text-xs font-semibold text-gray-800">Catalogo ABIO</p>
                <p className="text-xs text-gray-600">
                    Selecciona servicio, disciplina y horario desde el catalogo sincronizado. Si mas adelante recibes una tabla de amarre oficial, puedes usarla como apoyo opcional.
                </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                    <label className="text-xs font-medium">Servicio ABIO</label>
                    <select
                        value={props.serviceCode || ""}
                        onChange={(e) =>
                            props.onPatch({
                                servilexServiceCode: e.target.value,
                                servilexBindingId: null,
                            })
                        }
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        <option value="">Seleccionar servicio</option>
                        {services.map((service) => (
                            <option key={service.id} value={service.servicioCodigo}>
                                [{service.servicioCodigo}] {service.servicioDescripcion}
                            </option>
                        ))}
                    </select>
                </div>

                {usesStructuredCatalog && (
                    <div className="space-y-2">
                        <label className="text-xs font-medium">Disciplina ABIO</label>
                        <select
                            value={props.disciplineCode || ""}
                            onChange={(e) =>
                                props.onPatch({
                                    servilexDisciplineCode: e.target.value,
                                    servilexScheduleCode: "",
                                    servilexBindingId: null,
                                })
                            }
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                            <option value="">Seleccionar disciplina</option>
                            {disciplines.map((discipline) => (
                                <option key={discipline.id} value={discipline.disciplinaCodigo}>
                                    [{discipline.disciplinaCodigo}] {discipline.disciplinaNombre}
                                </option>
                            ))}
                        </select>
                    </div>
                )}

                {usesStructuredCatalog && (
                    <div className="space-y-2">
                        <label className="text-xs font-medium">Horario ABIO</label>
                        <select
                            value={props.scheduleCode || ""}
                            onChange={(e) => {
                                const nextScheduleCode = e.target.value
                                const selectedSchedule =
                                    schedules.find((schedule) => schedule.horarioCodigo === nextScheduleCode) || null

                                props.onPatch({
                                    servilexScheduleCode: nextScheduleCode,
                                    servilexBindingId: null,
                                    ...(props.indicator === "PN" || props.indicator === "PA"
                                        ? {
                                              servilexExtraConfig: {
                                                  cantidad: 1,
                                                  horaInicio: selectedSchedule?.horaInicio || "",
                                                  horaFin: selectedSchedule?.horaFin || "",
                                                  duracion:
                                                      selectedSchedule?.duracionHoras !== null &&
                                                      selectedSchedule?.duracionHoras !== undefined
                                                          ? selectedSchedule.duracionHoras
                                                          : 1,
                                              },
                                          }
                                        : {}),
                                })
                            }}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                            <option value="">Seleccionar horario</option>
                            {schedules.map((schedule) => (
                                <option key={schedule.id} value={schedule.horarioCodigo}>
                                    [{schedule.horarioCodigo}] {schedule.diaDescripcion}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {(bindings.length > 0 || props.bindingId) && (
                <div className="space-y-2">
                    <label className="text-xs font-medium">Tabla de amarre opcional</label>
                    <select
                        value={props.bindingId || ""}
                        onChange={(e) => {
                            const nextBinding =
                                bindings.find((binding) => binding.id === e.target.value) || null
                            applyBinding(nextBinding)
                        }}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        <option value="">
                            {loadingBindings
                                ? "Cargando bindings..."
                                : bindings.length > 0
                                    ? "Seleccionar combinacion valida (opcional)"
                                    : "No hay bindings para este filtro"}
                        </option>
                        {bindings.map((binding) => (
                            <option key={binding.id} value={binding.id}>
                                [{binding.horarioCodigo}] Piscina {binding.piscinaCodigo} - {binding.scheduleDescription || "Sin descripcion"}
                            </option>
                        ))}
                    </select>
                    {selectedBinding && (
                        <p className="text-xs text-gray-600">
                            Binding aplicado: piscina {selectedBinding.piscinaCodigo}, horario {selectedBinding.horarioCodigo}.
                        </p>
                    )}
                </div>
            )}

            {!usesStructuredCatalog && selectedService && (
                <p className="text-xs text-gray-600">
                    Servicio seleccionado: [{selectedService.servicioCodigo}] {selectedService.servicioDescripcion}
                </p>
            )}
        </div>
    )
}
