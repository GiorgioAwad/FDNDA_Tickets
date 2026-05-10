"use client"

import { Search, CreditCard, Ticket } from "lucide-react"
import { MotionStagger, MotionItem, MotionSection } from "@/components/ui/motion-section"

const steps = [
    {
        n: "01",
        icon: Search,
        title: "Elige tu evento",
        description: "Explora todos los eventos oficiales y encuentra el que te emociona.",
    },
    {
        n: "02",
        icon: CreditCard,
        title: "Compra seguro",
        description: "Paga con tarjeta o Yape. Procesamiento 100% seguro con Izipay.",
    },
    {
        n: "03",
        icon: Ticket,
        title: "Disfruta",
        description: "Recibe tu QR al instante. Solo muéstralo en la entrada y vive la experiencia.",
    },
]

export function HowItWorks() {
    return (
        <section className="py-14 sm:py-20 bg-white">
            <div className="container mx-auto px-4">
                <MotionSection className="text-center mb-10 sm:mb-14">
                    <p className="text-xs sm:text-sm font-bold uppercase tracking-widest text-coral mb-2">
                        Tan simple como
                    </p>
                    <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3">
                        ¿Cómo funciona?
                    </h2>
                    <p className="text-muted-foreground max-w-xl mx-auto">
                        Tres pasos para asegurar tu lugar en el próximo evento de la FDNDA.
                    </p>
                </MotionSection>

                <MotionStagger
                    className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8 relative"
                    stagger={0.1}
                >
                    {/* Connector line desktop */}
                    <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-fdnda-accent/40 to-transparent" aria-hidden="true" />

                    {steps.map((step) => {
                        const Icon = step.icon
                        return (
                            <MotionItem key={step.n}>
                                <div className="relative text-center px-4">
                                    <div className="relative inline-flex">
                                        <div className="absolute -inset-2 bg-gradient-to-br from-fdnda-accent/30 to-coral/30 rounded-full blur-xl opacity-50" aria-hidden="true" />
                                        <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white shadow-glow-primary mx-auto">
                                            <Icon className="h-9 w-9" />
                                        </div>
                                        <span className="absolute -top-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-coral text-white font-display text-xs font-bold shadow-md ring-4 ring-white">
                                            {step.n}
                                        </span>
                                    </div>
                                    <h3 className="font-display text-xl font-bold mt-5 mb-2">{step.title}</h3>
                                    <p className="text-sm text-muted-foreground leading-relaxed max-w-[260px] mx-auto">
                                        {step.description}
                                    </p>
                                </div>
                            </MotionItem>
                        )
                    })}
                </MotionStagger>
            </div>
        </section>
    )
}
