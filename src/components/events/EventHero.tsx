"use client"

import * as React from "react"
import Link from "next/link"
import { motion, useScroll, useTransform, useReducedMotion } from "framer-motion"
import { ArrowLeft, Waves, ChevronRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { EventBannerMedia } from "@/components/events/EventBannerMedia"

interface EventHeroProps {
    title: string
    bannerUrl?: string | null
    discipline?: string | null
    venue: string
    location: string
}

export function EventHero({ title, bannerUrl, discipline, venue, location }: EventHeroProps) {
    const ref = React.useRef<HTMLDivElement>(null)
    const prefersReducedMotion = useReducedMotion()
    const { scrollYProgress } = useScroll({
        target: ref,
        offset: ["start start", "end start"],
    })
    const y = useTransform(scrollYProgress, [0, 1], ["0%", "30%"])
    const overlayOpacity = useTransform(scrollYProgress, [0, 1], [0.6, 0.85])

    return (
        <section ref={ref} className="relative w-full aspect-[1200/630] min-h-[16rem] max-h-[36rem] bg-gradient-fdnda overflow-hidden">
            <motion.div className="absolute inset-0" style={prefersReducedMotion ? undefined : { y }}>
                {bannerUrl ? (
                    <EventBannerMedia
                        src={bannerUrl}
                        alt={title}
                        priority
                        sizes="100vw"
                        className="object-cover object-top scale-110"
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <Waves className="h-32 w-32 text-white/20" />
                    </div>
                )}
            </motion.div>

            <motion.div
                className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent"
                style={prefersReducedMotion ? undefined : { opacity: overlayOpacity }}
            />

            {/* Breadcrumbs top */}
            <div className="absolute top-4 left-0 right-0 z-10">
                <div className="container mx-auto px-4">
                    <nav className="flex items-center gap-1.5 text-xs sm:text-sm text-white/85" aria-label="Breadcrumb">
                        <Link
                            href="/"
                            className="hover:text-white transition-colors"
                        >
                            Inicio
                        </Link>
                        <ChevronRight className="h-3 w-3 text-white/50" />
                        <Link
                            href="/eventos"
                            className="inline-flex items-center gap-1 hover:text-white transition-colors"
                        >
                            Eventos
                        </Link>
                        {discipline && (
                            <>
                                <ChevronRight className="h-3 w-3 text-white/50" />
                                <Link
                                    href={`/eventos?discipline=${encodeURIComponent(discipline)}`}
                                    className="hover:text-white transition-colors"
                                >
                                    {discipline}
                                </Link>
                            </>
                        )}
                    </nav>
                </div>
            </div>

            {/* Back button */}
            <div className="absolute top-12 sm:top-14 left-0 right-0 z-10">
                <div className="container mx-auto px-4">
                    <Link
                        href="/eventos"
                        className="inline-flex items-center gap-1.5 rounded-full bg-white/15 backdrop-blur-md ring-1 ring-white/20 px-3 py-1.5 text-xs sm:text-sm text-white hover:bg-white/25 transition-all"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Volver a eventos
                    </Link>
                </div>
            </div>

            {/* Title at bottom */}
            <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6 lg:p-8">
                <div className="container mx-auto">
                    <div className="flex flex-wrap gap-2 mb-3">
                        {discipline && (
                            <Badge className="bg-white/15 backdrop-blur-md text-white ring-1 ring-white/30 hover:bg-white/25">
                                {discipline}
                            </Badge>
                        )}
                    </div>
                    <h1 className="font-display text-2xl sm:text-4xl md:text-5xl font-bold text-white leading-tight tracking-tight drop-shadow-lg max-w-4xl">
                        {title}
                    </h1>
                    <p className="mt-2 text-sm sm:text-base text-white/85">
                        {venue}, {location}
                    </p>
                </div>
            </div>
        </section>
    )
}
