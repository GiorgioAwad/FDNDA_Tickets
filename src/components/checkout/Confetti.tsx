"use client"

import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"

interface ConfettiProps {
    pieces?: number
    duration?: number
}

interface Piece {
    id: number
    left: number
    delay: number
    rotate: number
    color: string
    size: number
    drift: number
}

const COLORS = ["hsl(8 92% 58%)", "hsl(210 100% 40%)", "hsl(188 85% 48%)", "hsl(45 93% 58%)", "hsl(142 76% 42%)"]

export function Confetti({ pieces = 60, duration = 3.2 }: ConfettiProps) {
    const prefersReducedMotion = useReducedMotion()
    const [items, setItems] = React.useState<Piece[]>([])

    React.useEffect(() => {
        if (prefersReducedMotion) return
        const next: Piece[] = Array.from({ length: pieces }).map((_, i) => ({
            id: i,
            left: Math.random() * 100,
            delay: Math.random() * 0.3,
            rotate: Math.random() * 360,
            color: COLORS[i % COLORS.length],
            size: 6 + Math.random() * 8,
            drift: (Math.random() - 0.5) * 200,
        }))
        setItems(next)
    }, [pieces, prefersReducedMotion])

    if (prefersReducedMotion || items.length === 0) return null

    return (
        <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden" aria-hidden="true">
            {items.map((p) => (
                <motion.span
                    key={p.id}
                    initial={{ y: -20, x: 0, opacity: 1, rotate: 0 }}
                    animate={{
                        y: "110vh",
                        x: p.drift,
                        opacity: [1, 1, 0],
                        rotate: p.rotate + 720,
                    }}
                    transition={{ duration, delay: p.delay, ease: "easeIn" }}
                    style={{
                        position: "absolute",
                        left: `${p.left}%`,
                        top: 0,
                        width: p.size,
                        height: p.size * 0.5,
                        background: p.color,
                        borderRadius: 2,
                    }}
                />
            ))}
        </div>
    )
}
