"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { Waves, Trophy, Sparkles, Heart } from "lucide-react"
import { FloatingBubbles } from "@/components/ui/floating-bubbles"

const quotes = [
    { icon: Waves, text: "Cada brazada cuenta. Cada evento, también." },
    { icon: Trophy, text: "Vive la pasión del deporte acuático peruano." },
    { icon: Sparkles, text: "Más de 100 años forjando campeones." },
    { icon: Heart, text: "Únete a la familia FDNDA." },
]

interface AuthShellProps {
    title: string
    subtitle?: string
    children: React.ReactNode
    footer?: React.ReactNode
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
    const [quoteIdx, setQuoteIdx] = React.useState(0)
    const prefersReducedMotion = useReducedMotion()

    React.useEffect(() => {
        if (prefersReducedMotion) return
        const id = setInterval(() => setQuoteIdx((i) => (i + 1) % quotes.length), 4500)
        return () => clearInterval(id)
    }, [prefersReducedMotion])

    const Quote = quotes[quoteIdx]

    return (
        <div className="min-h-screen flex flex-col lg:flex-row">
            {/* Left: form */}
            <div className="flex flex-1 flex-col justify-center items-center px-4 py-10 sm:px-8 lg:px-12 bg-gradient-to-b from-white to-fdnda-light/20">
                <div className="w-full max-w-md">
                    <Link href="/" className="inline-flex items-center gap-2 mb-8">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white shadow-md">
                            <Image src="/logo.png" alt="FDNDA" width={28} height={28} className="h-7 w-7 object-contain" />
                        </div>
                        <div className="leading-tight">
                            <span className="font-display font-bold text-lg text-fdnda-primary">Ticketing</span>
                            <span className="ml-1.5 text-sm text-muted-foreground">FDNDA</span>
                        </div>
                    </Link>

                    <motion.div
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] as const }}
                    >
                        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight mb-2">
                            {title}
                        </h1>
                        {subtitle && <p className="text-muted-foreground mb-8">{subtitle}</p>}
                    </motion.div>

                    <motion.div
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.1, ease: [0.16, 1, 0.3, 1] as const }}
                    >
                        {children}
                    </motion.div>

                    {footer && <div className="mt-8 text-center text-sm text-muted-foreground">{footer}</div>}
                </div>
            </div>

            {/* Right: visual panel (hidden on mobile) */}
            <div className="hidden lg:flex flex-1 relative overflow-hidden bg-gradient-hero text-white">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(188,85%,48%,0.30),transparent_55%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,hsl(8,92%,58%,0.25),transparent_55%)]" />
                <FloatingBubbles count={12} />

                {/* Animated waves */}
                <svg className="absolute bottom-0 w-full opacity-25 animate-float-slow" viewBox="0 0 1440 320" preserveAspectRatio="none">
                    <path
                        fill="white"
                        d="M0,256L48,229.3C96,203,192,149,288,138.7C384,128,480,160,576,176C672,192,768,192,864,170.7C960,149,1056,107,1152,106.7C1248,107,1344,149,1392,170.7L1440,192L1440,320L0,320Z"
                    />
                </svg>

                <div className="relative z-10 flex flex-col justify-center items-center text-center p-12 w-full">
                    <Image
                        src="/logo.png"
                        alt="FDNDA"
                        width={120}
                        height={120}
                        className="h-24 w-24 sm:h-32 sm:w-32 object-contain mb-8 drop-shadow-2xl animate-float-slow"
                    />
                    <h2 className="font-display text-3xl xl:text-4xl font-bold mb-3 leading-tight max-w-md">
                        Tu acceso a las experiencias acuáticas más esperadas del Perú.
                    </h2>
                    <p className="text-white/80 max-w-md mb-12">
                        Desde 1926, formando atletas y conectando a las familias con el deporte acuático.
                    </p>

                    <AnimatePresence mode="wait">
                        <motion.div
                            key={quoteIdx}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -12 }}
                            transition={{ duration: 0.5 }}
                            className="inline-flex items-center gap-3 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 px-5 py-3 max-w-md"
                        >
                            <Quote.icon className="h-5 w-5 text-fdnda-accent shrink-0" />
                            <p className="text-sm text-white/90 italic text-left">{quotes[quoteIdx].text}</p>
                        </motion.div>
                    </AnimatePresence>
                </div>
            </div>
        </div>
    )
}
