"use client"

import * as React from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { Calendar, MapPin, ArrowRight, Waves, Flame } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EventBannerMedia } from "@/components/events/EventBannerMedia"
import { formatDate, formatPrice } from "@/lib/utils"
import { cn } from "@/lib/utils"

export type EventCardEvent = {
    id: string
    slug: string
    title: string
    bannerUrl?: string | null
    discipline?: string | null
    startDate: Date
    venue: string
    location: string
    minPrice?: number
    soldCount?: number
    capacity?: number
}

interface EventCardProps {
    event: EventCardEvent
    priority?: boolean
    sizes?: string
    className?: string
}

export function EventCard({ event, priority, sizes, className }: EventCardProps) {
    const prefersReducedMotion = useReducedMotion()
    const [days, setDays] = React.useState<number | null>(null)
    React.useEffect(() => {
        const ms = event.startDate.getTime() - Date.now()
        setDays(Math.ceil(ms / (1000 * 60 * 60 * 24)))
    }, [event.startDate])
    const soonish = days != null && days >= 0 && days <= 7
    const remaining = event.capacity != null && event.soldCount != null ? event.capacity - event.soldCount : null
    const lowStock = remaining != null && remaining > 0 && remaining < 50
    const fillRate = event.capacity && event.soldCount != null ? Math.min(1, event.soldCount / event.capacity) : null
    const isHot = fillRate != null && fillRate > 0.7

    return (
        <motion.div
            whileHover={prefersReducedMotion ? undefined : { y: -6 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className={cn("h-full", className)}
        >
            <Link href={`/eventos/${event.slug}`} className="group block h-full">
                <article className="relative h-full flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all duration-300 group-hover:shadow-card-hover">
                    {/* Image */}
                    <div className="relative aspect-[16/10] overflow-hidden bg-gradient-fdnda">
                        {event.bannerUrl ? (
                            <EventBannerMedia
                                src={event.bannerUrl}
                                alt={event.title}
                                sizes={sizes ?? "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"}
                                priority={priority}
                                className="object-cover transition-transform duration-700 group-hover:scale-110"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <Waves className="h-16 w-16 text-white/30" />
                            </div>
                        )}
                        {/* Gradient overlay (always-on, slight) */}
                        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />

                        {/* Top badges */}
                        <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
                            {event.discipline && (
                                <Badge className="bg-white/95 backdrop-blur-sm text-foreground font-semibold shadow-md hover:bg-white">
                                    {event.discipline}
                                </Badge>
                            )}
                            <div className="flex flex-col items-end gap-1.5 ml-auto">
                                {soonish && (
                                    <Badge className="bg-coral text-white font-semibold shadow-glow-coral animate-pulse">
                                        <Flame className="h-3 w-3 mr-1" />
                                        {days === 0 ? "¡Hoy!" : days === 1 ? "Mañana" : `En ${days} días`}
                                    </Badge>
                                )}
                                {!soonish && isHot && (
                                    <Badge className="bg-coral/95 text-white font-semibold shadow-md">
                                        <Flame className="h-3 w-3 mr-1" />Top venta
                                    </Badge>
                                )}
                            </div>
                        </div>

                        {/* Date overlay (bottom-left) */}
                        <div className="absolute bottom-3 left-3 text-white">
                            <div className="font-display text-2xl font-bold leading-none">
                                {event.startDate.toLocaleDateString("es-PE", { day: "2-digit" })}
                            </div>
                            <div className="text-[10px] uppercase tracking-wider font-semibold opacity-90">
                                {event.startDate.toLocaleDateString("es-PE", { month: "short" })}
                            </div>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col p-5">
                        <h3 className="font-display font-bold text-lg leading-snug mb-2 line-clamp-2 group-hover:text-fdnda-secondary transition-colors">
                            {event.title}
                        </h3>

                        <div className="space-y-1.5 text-sm text-muted-foreground mb-4">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-fdnda-secondary shrink-0" />
                                <span>{formatDate(event.startDate)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <MapPin className="h-3.5 w-3.5 text-fdnda-secondary shrink-0" />
                                <span className="line-clamp-1">{event.venue}, {event.location}</span>
                            </div>
                        </div>

                        {/* Capacity bar */}
                        {fillRate != null && fillRate > 0 && (
                            <div className="mb-3">
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                                    <span>{Math.round(fillRate * 100)}% vendido</span>
                                    {lowStock && <span className="text-coral font-semibold">Quedan {remaining}</span>}
                                </div>
                                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                    <div
                                        className={cn(
                                            "h-full rounded-full transition-all duration-700",
                                            fillRate > 0.85 ? "bg-coral" : "bg-gradient-to-r from-fdnda-secondary to-fdnda-accent"
                                        )}
                                        style={{ width: `${fillRate * 100}%` }}
                                    />
                                </div>
                            </div>
                        )}

                        <div className="mt-auto flex items-center justify-between pt-3 border-t border-border">
                            <div>
                                {event.minPrice != null && (
                                    <>
                                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Desde</div>
                                        <div className="font-display text-lg font-bold text-fdnda-primary">
                                            {formatPrice(event.minPrice)}
                                        </div>
                                    </>
                                )}
                            </div>
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-fdnda-secondary group-hover:text-coral transition-colors">
                                Ver más
                                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                            </span>
                        </div>
                    </div>
                </article>
            </Link>
        </motion.div>
    )
}
