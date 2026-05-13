"use client"

import * as React from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { Calendar, MapPin, ArrowRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Countdown } from "@/components/ui/countdown"
import { EventBannerMedia } from "@/components/events/EventBannerMedia"
import { formatDate, formatPrice } from "@/lib/utils"
import type { EventCardEvent } from "./EventCard"

interface FeaturedEventProps {
    event: EventCardEvent & { description?: string | null }
}

export function FeaturedEvent({ event }: FeaturedEventProps) {
    const prefersReducedMotion = useReducedMotion()
    const [showCountdown, setShowCountdown] = React.useState(false)

    React.useEffect(() => {
        const days = Math.ceil((event.startDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        setShowCountdown(days > 0 && days <= 30)
    }, [event.startDate])

    return (
        <motion.section
            initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative overflow-hidden rounded-3xl shadow-elevated"
        >
            <div className="absolute inset-0">
                {event.bannerUrl ? (
                    <EventBannerMedia
                        src={event.bannerUrl}
                        alt={event.title}
                        sizes="100vw"
                        priority
                        className="object-cover"
                    />
                ) : (
                    <div className="w-full h-full bg-gradient-fdnda" />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/30" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_50%,hsl(8,92%,58%,0.30),transparent_60%)]" />
            </div>

            <div className="relative p-6 sm:p-10 lg:p-14 min-h-[420px] sm:min-h-[480px] flex flex-col justify-end text-white">
                <div className="max-w-2xl">
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                        <Badge className="bg-coral text-white shadow-glow-coral">
                            <Sparkles className="h-3 w-3 mr-1" />Evento destacado
                        </Badge>
                        {event.discipline && (
                            <Badge className="bg-white/15 backdrop-blur-md text-white ring-1 ring-white/30">
                                {event.discipline}
                            </Badge>
                        )}
                    </div>

                    <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight mb-3 drop-shadow-lg">
                        {event.title}
                    </h2>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:text-base text-white/90 mb-6">
                        <div className="flex items-center gap-1.5">
                            <Calendar className="h-4 w-4 text-fdnda-accent" />
                            <span>{formatDate(event.startDate)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <MapPin className="h-4 w-4 text-fdnda-accent" />
                            <span>
                                {event.venue}, {event.location}
                            </span>
                        </div>
                    </div>

                    {showCountdown && (
                        <div className="mb-6">
                            <p className="text-[10px] uppercase tracking-widest text-white/70 mb-2">Comienza en</p>
                            <Countdown target={event.startDate} size="md" />
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
                        <Link href={`/eventos/${event.slug}`}>
                            <Button size="lg" variant="coral" className="rounded-full px-7 group">
                                Comprar entradas
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </Button>
                        </Link>
                        {event.minPrice != null && (
                            <div className="text-white/85">
                                <span className="text-xs uppercase tracking-wider mr-2">Desde</span>
                                <span className="font-display text-xl font-bold">{formatPrice(event.minPrice)}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </motion.section>
    )
}
