"use client"

import * as React from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "framer-motion"
import { Calendar, MapPin, User, QrCode, ArrowRight } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"

export interface TicketCardItemProps {
    id: string
    status: "ACTIVE" | "CANCELLED" | "EXPIRED"
    attendeeName: string | null
    typeName: string
    eventTitle: string
    eventStartDate: Date
    eventVenue: string
    discipline?: string | null
    bannerUrl?: string | null
    scheduleLabel?: string | null
    isPast?: boolean
    index?: number
    groupIndex?: number
    groupTotal?: number
    used?: boolean
}

type CardStatus = "ACTIVE" | "CANCELLED" | "EXPIRED" | "USED"

const statusConfig: Record<CardStatus, { label: string; tone: string }> = {
    ACTIVE: { label: "Activo", tone: "bg-success text-white" },
    CANCELLED: { label: "Cancelado", tone: "bg-coral text-white" },
    EXPIRED: { label: "Expirado", tone: "bg-muted-foreground/80 text-white" },
    USED: { label: "Usada", tone: "bg-emerald-600 text-white" },
}

export function TicketCardItem({
    id,
    status,
    attendeeName,
    typeName,
    eventTitle,
    eventStartDate,
    eventVenue,
    discipline,
    bannerUrl,
    scheduleLabel,
    isPast = false,
    index = 0,
    groupIndex,
    groupTotal,
    used = false,
}: TicketCardItemProps) {
    const prefersReducedMotion = useReducedMotion()
    const effectiveStatus: CardStatus =
        status === "ACTIVE" && used
            ? "USED"
            : isPast && status === "ACTIVE"
                ? "EXPIRED"
                : status
    const effectiveCfg = statusConfig[effectiveStatus]
    const showGroupBadge = typeof groupIndex === "number" && typeof groupTotal === "number" && groupTotal > 1

    return (
        <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: Math.min(index * 0.05, 0.4), ease: [0.16, 1, 0.3, 1] as const }}
        >
            <Link href={`/mi-cuenta/entradas/${id}`} className="group block">
                <div className="relative rounded-2xl overflow-hidden bg-card border border-border shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-0.5">
                    {/* Top: gradient header with banner */}
                    <div className="relative h-32 sm:h-36 overflow-hidden">
                        {bannerUrl ? (
                            <>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={bannerUrl}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                                />
                                <div className="absolute inset-0 bg-gradient-to-br from-fdnda-primary/85 via-fdnda-secondary/70 to-fdnda-primary/85" />
                            </>
                        ) : (
                            <div className="absolute inset-0 bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary" />
                        )}
                        <div className="relative h-full p-4 flex flex-col justify-between text-white">
                            <div className="flex justify-between items-start gap-2">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge className="bg-white/20 text-white ring-1 ring-white/30 hover:bg-white/30 font-medium">
                                        {typeName}
                                    </Badge>
                                    {showGroupBadge && (
                                        <span className="inline-flex items-center rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-white/20">
                                            Entrada {groupIndex} de {groupTotal}
                                        </span>
                                    )}
                                </div>
                                <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", effectiveCfg.tone)}>
                                    {effectiveCfg.label}
                                </span>
                            </div>
                            <div>
                                <h3 className="font-display font-bold text-base sm:text-lg leading-tight line-clamp-2 drop-shadow">
                                    {eventTitle}
                                </h3>
                                {discipline && (
                                    <p className="text-[11px] text-white/80 uppercase tracking-wider mt-0.5">{discipline}</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Tear strip with circles */}
                    <div className="relative h-4 bg-card flex items-center">
                        <div className="absolute -left-2 h-4 w-4 rounded-full bg-fdnda-light/30 border border-border" aria-hidden="true" />
                        <div className="absolute -right-2 h-4 w-4 rounded-full bg-fdnda-light/30 border border-border" aria-hidden="true" />
                        <div className="flex-1 mx-3 border-t-2 border-dashed border-border/70" aria-hidden="true" />
                    </div>

                    {/* Content */}
                    <div className="p-5 space-y-3">
                        <div className="space-y-1.5 text-sm text-muted-foreground">
                            <div className="flex items-center gap-2">
                                <Calendar className="h-3.5 w-3.5 text-fdnda-secondary shrink-0" />
                                <span>{scheduleLabel ?? formatDate(eventStartDate)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <MapPin className="h-3.5 w-3.5 text-fdnda-secondary shrink-0" />
                                <span className="line-clamp-1">{eventVenue}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <User className="h-3.5 w-3.5 text-fdnda-secondary shrink-0" />
                                <span className="line-clamp-1">{attendeeName ?? "Sin asignar"}</span>
                            </div>
                        </div>

                        <Button
                            variant={effectiveStatus === "ACTIVE" ? "coral" : "outline"}
                            className="w-full rounded-xl gap-2 group-hover:gap-3 transition-all"
                        >
                            <QrCode className="h-4 w-4" />
                            Ver mi QR
                            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                        </Button>
                    </div>
                </div>
            </Link>
        </motion.div>
    )
}
