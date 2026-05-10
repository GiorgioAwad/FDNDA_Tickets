"use client"

import * as React from "react"
import Link from "next/link"
import Image from "next/image"
import { Waves, Trophy, Activity, Users, Wind, Sun, type LucideIcon } from "lucide-react"
import { MotionStagger, MotionItem } from "@/components/ui/motion-section"

const ASSETS_BASE = "https://assets.ticketingfdnda.pe/disciplinas"

type Discipline = {
    name: string
    icon: LucideIcon
    image?: string
    gradient: string
}

// Las URLs apuntan a R2. Si la imagen aún no existe en el bucket (404) o falla,
// el componente cae automáticamente al icono Lucide. Sube los SVGs a:
//   https://assets.ticketingfdnda.pe/disciplinas/<slug>.svg
// y aparecen automáticamente al siguiente refresh, sin tocar código.
const disciplines: Discipline[] = [
    {
        name: "Natación",
        icon: Waves,
        image: `${ASSETS_BASE}/natacion.svg`,
        gradient: "from-fdnda-secondary to-fdnda-accent",
    },
    {
        name: "Waterpolo",
        icon: Users,
        image: `${ASSETS_BASE}/waterpolo.svg`,
        gradient: "from-fdnda-primary to-fdnda-secondary",
    },
    {
        name: "Clavados",
        icon: Activity,
        image: `${ASSETS_BASE}/clavados.svg`,
        gradient: "from-fdnda-accent to-coral",
    },
    {
        name: "Natación Artística",
        icon: Sun,
        image: `${ASSETS_BASE}/natacion-artistica.svg`,
        gradient: "from-coral to-coral-strong",
    },
    {
        name: "Aguas Abiertas",
        icon: Wind,
        image: `${ASSETS_BASE}/aguas-abiertas.svg`,
        gradient: "from-fdnda-secondary to-fdnda-primary",
    },
    {
        name: "Master",
        icon: Trophy,
        image: `${ASSETS_BASE}/master.svg`,
        gradient: "from-fdnda-primary to-coral",
    },
]

function DisciplineIcon({ discipline }: { discipline: Discipline }) {
    const [imageFailed, setImageFailed] = React.useState(false)
    const Icon = discipline.icon

    if (discipline.image && !imageFailed) {
        return (
            <Image
                src={discipline.image}
                alt=""
                width={64}
                height={64}
                className="h-7 w-7 sm:h-8 sm:w-8 object-contain"
                onError={() => setImageFailed(true)}
                unoptimized={discipline.image.endsWith(".svg")}
            />
        )
    }

    return <Icon className="h-6 w-6 sm:h-7 sm:w-7" />
}

export function DisciplinesGrid() {
    return (
        <section className="py-14 sm:py-20 bg-gradient-to-b from-white to-fdnda-light/30">
            <div className="container mx-auto px-4">
                <div className="text-center mb-10 sm:mb-12">
                    <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-coral mb-2">
                        Encuentra tu pasión
                    </p>
                    <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-foreground">
                        Disciplinas <span className="text-gradient-coral">acuáticas</span>
                    </h2>
                </div>

                <MotionStagger
                    className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4"
                    stagger={0.06}
                >
                    {disciplines.map((d) => (
                        <MotionItem key={d.name}>
                            <Link
                                href={`/eventos?discipline=${encodeURIComponent(d.name)}`}
                                className="group block"
                            >
                                <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5 text-center transition-all duration-300 hover:-translate-y-1 hover:shadow-card-hover hover:border-transparent">
                                    <div className={`absolute inset-0 bg-gradient-to-br ${d.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                                    <div className="relative">
                                        <div className={`mx-auto mb-3 flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-xl bg-gradient-to-br ${d.gradient} text-white shadow-lg transition-transform duration-500 group-hover:scale-110`}>
                                            <DisciplineIcon discipline={d} />
                                        </div>
                                        <p className="text-xs sm:text-sm font-semibold leading-tight transition-colors duration-300 group-hover:text-white">
                                            {d.name}
                                        </p>
                                    </div>
                                </div>
                            </Link>
                        </MotionItem>
                    ))}
                </MotionStagger>
            </div>
        </section>
    )
}
