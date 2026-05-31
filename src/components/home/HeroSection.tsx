"use client"

import Link from "next/link"
import Image from "next/image"
import { useSession } from "next-auth/react"
import { motion, useReducedMotion } from "framer-motion"
import { ArrowRight, Waves, Calendar, Trophy, Timer, Shield, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatCounter } from "@/components/ui/stat-counter"
import { FloatingBubbles } from "@/components/ui/floating-bubbles"

const stats = [
    { label: "Años de historia", value: 100, icon: Timer, suffix: "+" },
    { label: "Disciplinas", value: 6, icon: Trophy },
    { label: "Año de fundación", value: 1926, icon: Calendar },
    { label: "Plataforma oficial", value: 1, icon: Shield },
]

export function HeroSection() {
    const prefersReducedMotion = useReducedMotion()
    const { status } = useSession()
    // Mostrar el CTA de registro salvo que la sesión esté confirmada como activa.
    const showRegister = status !== "authenticated"

    return (
        <section className="relative isolate overflow-hidden">
            {/* Layered gradient background */}
            <div className="absolute inset-0 bg-gradient-hero" aria-hidden="true" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,hsl(188,85%,48%,0.20),transparent_50%)]" aria-hidden="true" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_80%,hsl(8,92%,58%,0.15),transparent_55%)]" aria-hidden="true" />

            {/* Floating bubbles */}
            <FloatingBubbles count={16} />

            {/* Animated waves (3 layers) */}
            <div className="absolute inset-x-0 bottom-0 pointer-events-none" aria-hidden="true">
                <svg className="absolute bottom-0 w-full h-auto opacity-25 animate-float-slow" viewBox="0 0 1440 320" preserveAspectRatio="none">
                    <path
                        fill="hsl(var(--fdnda-accent))"
                        d="M0,256L48,229.3C96,203,192,149,288,138.7C384,128,480,160,576,176C672,192,768,192,864,170.7C960,149,1056,107,1152,106.7C1248,107,1344,149,1392,170.7L1440,192L1440,320L0,320Z"
                    />
                </svg>
                <svg className="absolute bottom-0 w-full h-auto opacity-30 animate-float" viewBox="0 0 1440 320" preserveAspectRatio="none">
                    <path
                        fill="white"
                        fillOpacity="0.15"
                        d="M0,224L48,213.3C96,203,192,181,288,176C384,171,480,181,576,186.7C672,192,768,192,864,170.7C960,149,1056,107,1152,112C1248,117,1344,171,1392,197.3L1440,224L1440,320L0,320Z"
                    />
                </svg>
                <svg className="absolute bottom-0 w-full h-auto opacity-50 animate-float-fast" viewBox="0 0 1440 320" preserveAspectRatio="none">
                    <path
                        fill="white"
                        fillOpacity="0.10"
                        d="M0,288L48,277.3C96,267,192,245,288,234.7C384,224,480,224,576,213.3C672,203,768,181,864,181.3C960,181,1056,203,1152,213.3C1248,224,1344,224,1392,224L1440,224L1440,320L0,320Z"
                    />
                </svg>
            </div>

            <div className="relative flex min-h-[78vh] sm:min-h-[82vh] lg:min-h-[88vh] items-center justify-center">
                <div className="container mx-auto px-4 py-16 sm:py-20 text-center text-white">
                    <motion.div
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                        className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md ring-1 ring-white/20 px-4 py-2 mb-6 shadow-lg"
                    >
                        <Image src="/logo.png" alt="" width={20} height={20} className="h-5 w-5 object-contain" priority />
                        <Waves className="h-4 w-4 text-fdnda-accent" />
                        <span className="text-[11px] sm:text-xs font-semibold tracking-wide">
                            FEDERACIÓN DEPORTIVA NACIONAL DE DEPORTES ACUÁTICOS
                        </span>
                    </motion.div>

                    <motion.h1
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                        className="font-display text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-5 sm:mb-7 leading-[1.05] tracking-tight"
                    >
                        Vive la emoción del{" "}
                        <span className="block sm:inline bg-gradient-to-r from-fdnda-accent via-white to-coral bg-clip-text text-transparent animate-gradient">
                            deporte acuático
                        </span>
                    </motion.h1>

                    <motion.p
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
                        className="text-base sm:text-lg md:text-xl text-white/85 max-w-2xl mx-auto mb-8 sm:mb-10 px-2 sm:px-0 leading-relaxed"
                    >
                        Compra entradas para los mejores eventos de natación, waterpolo, clavados y más. Experiencias únicas que no puedes perderte.
                    </motion.p>

                    <motion.div
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        className="flex flex-col sm:flex-row gap-3 sm:gap-4 justify-center"
                    >
                        <Link href="/eventos">
                            <Button size="xl" variant="coral" className="w-full sm:w-auto rounded-full px-8 group">
                                Ver eventos
                                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                            </Button>
                        </Link>
                        {showRegister && (
                            <Link href="/register">
                                <Button size="xl" variant="glass" className="w-full sm:w-auto rounded-full px-8">
                                    Crear cuenta gratis
                                </Button>
                            </Link>
                        )}
                    </motion.div>

                    {/* Stats */}
                    <motion.div
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.7, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                        className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-12 sm:mt-16 max-w-3xl mx-auto"
                    >
                        {stats.map((stat) => (
                            <div
                                key={stat.label}
                                className="group p-4 sm:p-5 rounded-2xl bg-white/[0.07] backdrop-blur-md ring-1 ring-white/15 transition-all duration-300 hover:bg-white/[0.12] hover:scale-[1.03] hover:ring-white/30"
                            >
                                <stat.icon className="h-5 w-5 sm:h-6 sm:w-6 mb-2 mx-auto text-fdnda-accent" />
                                <div className="font-display text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">
                                    <StatCounter value={stat.value} suffix={stat.suffix ?? ""} />
                                </div>
                                <div className="text-[11px] sm:text-xs text-white/70 mt-0.5 uppercase tracking-wider">{stat.label}</div>
                            </div>
                        ))}
                    </motion.div>

                    {/* Scroll indicator */}
                    <motion.div
                        initial={prefersReducedMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 1, delay: 1.2 }}
                        className="hidden md:flex absolute bottom-8 left-1/2 -translate-x-1/2 flex-col items-center gap-1 text-white/60"
                        aria-hidden="true"
                    >
                        <span className="text-[10px] uppercase tracking-widest">Scroll</span>
                        <ChevronDown className="h-4 w-4 animate-float-fast" />
                    </motion.div>
                </div>
            </div>
        </section>
    )
}
