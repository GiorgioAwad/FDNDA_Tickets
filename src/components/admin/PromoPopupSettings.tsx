"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ImageUploader } from "@/components/ui/image-uploader"
import { PromoPopupCard } from "@/components/promo/PromoPopupCard"
import { PROMO_SECTIONS, resolvePromoImage, type PromoPopupErrors } from "@/lib/promo-popup"
import {
    AlertCircle,
    CheckCircle,
    Eye,
    Loader2,
    Megaphone,
    MousePointerClick,
    RefreshCw,
    TrendingUp,
    XCircle,
} from "lucide-react"

const SECTION_LABELS: Record<string, string> = {
    INICIO: "Inicio",
    EVENTOS: "Eventos",
    MERCH: "Merch",
    MI_CUENTA: "Mi cuenta",
    TODO_PUBLICO: "Todo el sitio público",
}

interface FormState {
    isActive: boolean
    eyebrow: string
    kicker: string
    title: string
    description: string
    imageUrl: string
    linkUrl: string
    linkLabel: string
    mediaCaption: string
    sections: string[]
}

const EMPTY_FORM: FormState = {
    isActive: false,
    eyebrow: "",
    kicker: "",
    title: "",
    description: "",
    imageUrl: "",
    linkUrl: "",
    linkLabel: "",
    mediaCaption: "",
    sections: [],
}

interface PromoMetrics {
    version: string
    impressions: number
    clicks: number
    closes: number
    clickThroughRate: number
    closeRate: number
    clickSources: Record<string, number>
    closeSources: Record<string, number>
    topRoutes: Array<{ pathname: string; count: number }>
    lastEventAt: string | null
}

export function PromoPopupSettings() {
    const [form, setForm] = useState<FormState>(EMPTY_FORM)
    const [errors, setErrors] = useState<PromoPopupErrors>({})
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [saved, setSaved] = useState(false)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [metrics, setMetrics] = useState<PromoMetrics | null>(null)
    const [isLoadingMetrics, setIsLoadingMetrics] = useState(true)
    const [metricsError, setMetricsError] = useState<string | null>(null)

    const loadMetrics = useCallback(async () => {
        setIsLoadingMetrics(true)
        setMetricsError(null)
        try {
            const res = await fetch("/api/admin/promo-popup/metrics", { cache: "no-store" })
            const result = await res.json()
            if (!result.success) {
                setMetricsError(result.error ?? "No se pudieron cargar las metricas")
                return
            }
            setMetrics(result.metrics)
        } catch {
            setMetricsError("No se pudieron cargar las metricas")
        } finally {
            setIsLoadingMetrics(false)
        }
    }, [])

    useEffect(() => {
        let cancelled = false

        fetch("/api/admin/promo-popup")
            .then((res) => res.json())
            .then((result) => {
                if (cancelled) return
                if (!result.success) {
                    setLoadError(result.error ?? "No se pudo cargar el popup")
                    return
                }
                if (result.promo) {
                    setForm({
                        isActive: result.promo.isActive,
                        eyebrow: result.promo.eyebrow ?? "",
                        kicker: result.promo.kicker ?? "",
                        title: result.promo.title ?? "",
                        description: result.promo.description ?? "",
                        imageUrl: result.promo.imageUrl ?? "",
                        linkUrl: result.promo.linkUrl ?? "",
                        linkLabel: result.promo.linkLabel ?? "",
                        mediaCaption: result.promo.mediaCaption ?? "",
                        sections: result.promo.sections ?? [],
                    })
                }
            })
            .catch(() => {
                if (!cancelled) setLoadError("No se pudo cargar el popup")
            })
            .finally(() => {
                if (!cancelled) setIsLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        void loadMetrics()
    }, [loadMetrics])

    const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
        setForm((prev) => ({ ...prev, [key]: value }))
        setSaved(false)
    }

    const toggleSection = (section: string) => {
        setSaved(false)
        setForm((prev) => {
            // "Todo el sitio publico" es excluyente: no tiene sentido combinarlo.
            if (section === "TODO_PUBLICO") {
                return { ...prev, sections: prev.sections.includes(section) ? [] : ["TODO_PUBLICO"] }
            }
            const withoutGlobal = prev.sections.filter((s) => s !== "TODO_PUBLICO")
            return {
                ...prev,
                sections: withoutGlobal.includes(section)
                    ? withoutGlobal.filter((s) => s !== section)
                    : [...withoutGlobal, section],
            }
        })
    }

    const handleSave = async () => {
        setIsSaving(true)
        setErrors({})
        setSaved(false)
        setLoadError(null)

        try {
            const res = await fetch("/api/admin/promo-popup", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
            })
            const result = await res.json()

            if (!result.success) {
                setErrors(result.errors ?? {})
                if (!result.errors) setLoadError(result.error ?? "No se pudo guardar")
                return
            }

            setSaved(true)
            await loadMetrics()
            setTimeout(() => setSaved(false), 4000)
        } catch {
            setLoadError("No se pudo guardar el popup")
        } finally {
            setIsSaving(false)
        }
    }

    const previewData = {
        eyebrow: form.eyebrow || null,
        kicker: form.kicker || null,
        title: form.title || "Título del popup",
        description: form.description || null,
        image: resolvePromoImage(form.linkUrl || null, form.imageUrl || null),
        mediaCaption: form.mediaCaption || null,
        linkUrl: form.linkUrl || null,
        linkLabel: form.linkLabel || null,
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Megaphone className="h-5 w-5" />
                    Popup promocional
                </CardTitle>
                <CardDescription>
                    Anuncio que se muestra una vez por sesión a los visitantes. Los cambios tardan
                    hasta un minuto en verse en el sitio.
                </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6">
                {isLoading ? (
                    <p className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Cargando…
                    </p>
                ) : (
                    <>
                        {loadError ? (
                            <p className="flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                                <AlertCircle className="h-4 w-4" />
                                {loadError}
                            </p>
                        ) : null}

                        <PromoMetricsPanel
                            metrics={metrics}
                            isLoading={isLoadingMetrics}
                            error={metricsError}
                            onRefresh={loadMetrics}
                        />

                        <label className="flex items-center gap-3">
                            <input
                                type="checkbox"
                                checked={form.isActive}
                                onChange={(e) => update("isActive", e.target.checked)}
                                className="h-5 w-5 rounded border-gray-300"
                            />
                            <span className="text-sm font-semibold">Popup activo</span>
                        </label>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field label="Etiqueta superior" hint="Ej: Estreno FDNDA">
                                <Input
                                    value={form.eyebrow}
                                    onChange={(e) => update("eyebrow", e.target.value)}
                                />
                            </Field>
                            <Field label="Antetítulo" hint="Ej: Voces del Agua">
                                <Input
                                    value={form.kicker}
                                    onChange={(e) => update("kicker", e.target.value)}
                                />
                            </Field>
                        </div>

                        <Field label="Título" error={errors.title}>
                            <Input
                                value={form.title}
                                onChange={(e) => update("title", e.target.value)}
                            />
                        </Field>

                        <Field label="Descripción">
                            <textarea
                                value={form.description}
                                onChange={(e) => update("description", e.target.value)}
                                rows={3}
                                className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-fdnda-primary focus:outline-none"
                            />
                        </Field>

                        <Field label="Pie de la imagen" hint="Ej: Temporada 1 · Episodio 1">
                            <Input
                                value={form.mediaCaption}
                                onChange={(e) => update("mediaCaption", e.target.value)}
                            />
                        </Field>

                        <div className="grid gap-4 md:grid-cols-2">
                            <Field
                                label="Enlace"
                                hint="Opcional. Si es de YouTube, la miniatura se saca sola."
                                error={errors.linkUrl}
                            >
                                <Input
                                    value={form.linkUrl}
                                    onChange={(e) => update("linkUrl", e.target.value)}
                                    placeholder="https://www.youtube.com/watch?v=..."
                                />
                            </Field>
                            <Field label="Texto del botón" error={errors.linkLabel}>
                                <Input
                                    value={form.linkLabel}
                                    onChange={(e) => update("linkLabel", e.target.value)}
                                    placeholder="Ver ahora en YouTube"
                                />
                            </Field>
                        </div>

                        <div>
                            <ImageUploader
                                value={form.imageUrl}
                                onChange={(url) => update("imageUrl", url)}
                                type="promo"
                                label="Imagen propia (opcional)"
                            />
                            <p className="mt-2 text-xs text-gray-500">
                                Tamaño recomendado 1200 × 1500 px. Si la dejas vacía y el enlace es
                                de YouTube, se usa la miniatura del video.
                            </p>
                            {errors.imageUrl ? (
                                <p className="mt-1 text-xs text-red-600">{errors.imageUrl}</p>
                            ) : null}
                        </div>

                        <div>
                            <p className="mb-2 text-sm font-semibold">¿Dónde aparece?</p>
                            <div className="flex flex-wrap gap-3">
                                {PROMO_SECTIONS.map((section) => (
                                    <label
                                        key={section}
                                        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                                    >
                                        <input
                                            type="checkbox"
                                            checked={form.sections.includes(section)}
                                            disabled={
                                                section !== "TODO_PUBLICO" &&
                                                form.sections.includes("TODO_PUBLICO")
                                            }
                                            onChange={() => toggleSection(section)}
                                            className="h-4 w-4 rounded border-gray-300"
                                        />
                                        {SECTION_LABELS[section]}
                                    </label>
                                ))}
                            </div>
                            {errors.sections ? (
                                <p className="mt-1 text-xs text-red-600">{errors.sections}</p>
                            ) : null}
                            <p className="mt-2 text-xs text-gray-500">
                                Nunca aparece en el panel de admin, el escáner, tesorería ni el
                                proceso de pago.
                            </p>
                        </div>

                        <div>
                            <p className="mb-3 text-sm font-semibold">Vista previa</p>
                            <div className="scale-[0.85] overflow-hidden rounded-2xl bg-gray-100 p-4">
                                <PromoPopupCard data={previewData} variant="preview" />
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <Button onClick={handleSave} disabled={isSaving}>
                                {isSaving ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Guardando…
                                    </>
                                ) : (
                                    "Guardar popup"
                                )}
                            </Button>
                            {saved ? (
                                <span className="flex items-center gap-1 text-sm text-green-600">
                                    <CheckCircle className="h-4 w-4" />
                                    Guardado
                                </span>
                            ) : null}
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    )
}

const CLICK_SOURCE_LABELS: Record<string, string> = {
    media: "Imagen/video",
    cta: "Boton principal",
}

const CLOSE_SOURCE_LABELS: Record<string, string> = {
    close_button: "Boton X",
    continue_button: "Seguir viendo entradas",
    backdrop: "Fondo oscuro",
    escape: "Tecla Escape",
}

function PromoMetricsPanel({
    metrics,
    isLoading,
    error,
    onRefresh,
}: {
    metrics: PromoMetrics | null
    isLoading: boolean
    error: string | null
    onRefresh: () => Promise<void>
}) {
    const number = new Intl.NumberFormat("es-PE")
    const statCards = [
        {
            label: "Impresiones",
            value: metrics ? number.format(metrics.impressions) : "—",
            detail: "Sesiones que lo vieron",
            icon: Eye,
        },
        {
            label: "Clics",
            value: metrics ? number.format(metrics.clicks) : "—",
            detail: "En imagen o boton",
            icon: MousePointerClick,
        },
        {
            label: "CTR",
            value: metrics ? `${metrics.clickThroughRate.toFixed(1)}%` : "—",
            detail: "Clics / impresiones",
            icon: TrendingUp,
        },
        {
            label: "Cierres",
            value: metrics ? number.format(metrics.closes) : "—",
            detail: metrics ? `${metrics.closeRate.toFixed(1)}% de impresiones` : "Sin datos",
            icon: XCircle,
        },
    ]

    return (
        <section className="rounded-2xl border border-gray-200 bg-gray-50/70 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 className="font-semibold text-gray-900">Rendimiento de la version actual</h3>
                    <p className="mt-1 text-xs text-gray-500">
                        Datos anonimos por sesion. Al guardar cambios comienza una nueva version.
                    </p>
                </div>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void onRefresh()}
                    disabled={isLoading}
                >
                    <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
                    Actualizar
                </Button>
            </div>

            {error ? (
                <p className="mb-4 flex items-center gap-2 text-sm text-red-600">
                    <AlertCircle className="h-4 w-4" />
                    {error}
                </p>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {statCards.map((stat) => {
                    const Icon = stat.icon
                    return (
                        <div key={stat.label} className="rounded-xl border bg-white p-4">
                            <div className="flex items-center justify-between text-gray-500">
                                <span className="text-xs font-semibold uppercase tracking-wide">
                                    {stat.label}
                                </span>
                                <Icon className="h-4 w-4" />
                            </div>
                            <p className="mt-2 text-2xl font-bold text-fdnda-primary">{stat.value}</p>
                            <p className="mt-1 text-xs text-gray-500">{stat.detail}</p>
                        </div>
                    )
                })}
            </div>

            {metrics && metrics.impressions > 0 ? (
                <div className="mt-4 grid gap-4 text-sm md:grid-cols-3">
                    <MetricBreakdown
                        title="Origen de los clics"
                        values={metrics.clickSources}
                        labels={CLICK_SOURCE_LABELS}
                    />
                    <MetricBreakdown
                        title="Como lo cerraron"
                        values={metrics.closeSources}
                        labels={CLOSE_SOURCE_LABELS}
                    />
                    <div className="rounded-xl border bg-white p-4">
                        <p className="font-semibold text-gray-800">Rutas con mas vistas</p>
                        {metrics.topRoutes.length > 0 ? (
                            <ul className="mt-2 space-y-1.5 text-gray-600">
                                {metrics.topRoutes.map((route) => (
                                    <li key={route.pathname} className="flex justify-between gap-3">
                                        <span className="truncate" title={route.pathname}>
                                            {route.pathname}
                                        </span>
                                        <strong>{number.format(route.count)}</strong>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="mt-2 text-gray-500">Sin datos todavia.</p>
                        )}
                    </div>
                </div>
            ) : null}

            {metrics?.lastEventAt ? (
                <p className="mt-3 text-right text-xs text-gray-400">
                    Ultima actividad: {new Date(metrics.lastEventAt).toLocaleString("es-PE")}
                </p>
            ) : null}
        </section>
    )
}

function MetricBreakdown({
    title,
    values,
    labels,
}: {
    title: string
    values: Record<string, number>
    labels: Record<string, string>
}) {
    const entries = Object.entries(values).sort((a, b) => b[1] - a[1])
    return (
        <div className="rounded-xl border bg-white p-4">
            <p className="font-semibold text-gray-800">{title}</p>
            {entries.length > 0 ? (
                <ul className="mt-2 space-y-1.5 text-gray-600">
                    {entries.map(([source, count]) => (
                        <li key={source} className="flex justify-between gap-3">
                            <span>{labels[source] ?? source}</span>
                            <strong>{new Intl.NumberFormat("es-PE").format(count)}</strong>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="mt-2 text-gray-500">Sin datos todavia.</p>
            )}
        </div>
    )
}

function Field({
    label,
    hint,
    error,
    children,
}: {
    label: string
    hint?: string
    error?: string
    children: React.ReactNode
}) {
    return (
        <div>
            <label className="mb-1 block text-sm font-semibold">{label}</label>
            {children}
            {hint && !error ? <p className="mt-1 text-xs text-gray-500">{hint}</p> : null}
            {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
    )
}
