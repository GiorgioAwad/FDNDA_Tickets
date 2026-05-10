"use client"

import * as React from "react"
import { Countdown } from "@/components/ui/countdown"
import { Calendar } from "lucide-react"

interface EventCountdownStripProps {
    startDate: Date
    showWithinDays?: number
}

export function EventCountdownStrip({ startDate, showWithinDays = 30 }: EventCountdownStripProps) {
    const [show, setShow] = React.useState(false)

    React.useEffect(() => {
        const days = Math.ceil((startDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        setShow(days > 0 && days <= showWithinDays)
    }, [startDate, showWithinDays])

    if (!show) return null

    return (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary p-5 sm:p-6 shadow-elevated">
            <div className="absolute -top-12 -right-12 h-40 w-40 rounded-full bg-coral/30 blur-3xl" aria-hidden="true" />
            <div className="absolute -bottom-12 -left-12 h-40 w-40 rounded-full bg-fdnda-accent/30 blur-3xl" aria-hidden="true" />
            <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="text-white">
                    <div className="inline-flex items-center gap-1.5 text-[10px] sm:text-xs uppercase tracking-widest text-white/80 mb-1">
                        <Calendar className="h-3 w-3" />
                        Faltan
                    </div>
                    <p className="text-sm sm:text-base text-white/90">
                        ¡No te lo pierdas! Asegura tu entrada antes de que se agote.
                    </p>
                </div>
                <Countdown target={startDate} size="md" />
            </div>
        </div>
    )
}
