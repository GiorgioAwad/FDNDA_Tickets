import Link from "next/link"
import { ArrowRight, ShoppingBag, Shirt, Tag, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MotionSection, MotionStagger, MotionItem } from "@/components/ui/motion-section"

const TEASER_ITEMS = [
    {
        icon: Star,
        label: "Pines",
        price: "S/ 10",
        bg: "bg-gradient-to-br from-amber-100 via-yellow-50 to-orange-50",
        accent: "text-amber-600",
    },
    {
        icon: Tag,
        label: "Gorras",
        price: "S/ 20",
        bg: "bg-gradient-to-br from-emerald-100 via-green-50 to-teal-50",
        accent: "text-emerald-600",
    },
    {
        icon: Shirt,
        label: "Poleras",
        price: "S/ 80",
        bg: "bg-gradient-to-br from-blue-100 via-blue-50 to-cyan-50",
        accent: "text-blue-600",
    },
]

export function MerchTeaser() {
    return (
        <section className="py-14 sm:py-20 bg-gradient-to-br from-fdnda-light/40 via-white to-coral-soft/30 relative overflow-hidden">
            <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-coral/15 blur-3xl" aria-hidden />
            <div className="absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-fdnda-primary/15 blur-3xl" aria-hidden />

            <div className="relative container mx-auto px-4">
                <MotionSection className="text-center mb-10 sm:mb-12 max-w-2xl mx-auto">
                    <Badge variant="info" className="mb-3">
                        <ShoppingBag className="h-3 w-3 mr-1" />
                        Nuevo
                    </Badge>
                    <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3">
                        Merch oficial FDNDA
                    </h2>
                    <p className="text-muted-foreground">
                        Lleva los colores de tu zona del Campeonato Descentralizado. Poleras, gorras y pines edición limitada.
                    </p>
                </MotionSection>

                <MotionStagger className="grid grid-cols-3 gap-3 sm:gap-6 max-w-3xl mx-auto" stagger={0.08}>
                    {TEASER_ITEMS.map((item) => {
                        const Icon = item.icon
                        return (
                            <MotionItem key={item.label}>
                                <Link
                                    href="/merch"
                                    className={`group relative block rounded-2xl border border-border bg-white overflow-hidden shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1`}
                                >
                                    <div className={`aspect-square flex items-center justify-center ${item.bg}`}>
                                        <Icon className={`h-12 w-12 sm:h-16 sm:w-16 ${item.accent} group-hover:scale-110 transition-transform duration-300`} />
                                    </div>
                                    <div className="p-3 sm:p-4 text-center">
                                        <p className="font-display font-bold text-sm sm:text-base">{item.label}</p>
                                        <p className={`text-xs sm:text-sm font-semibold ${item.accent}`}>desde {item.price}</p>
                                    </div>
                                </Link>
                            </MotionItem>
                        )
                    })}
                </MotionStagger>

                <div className="text-center mt-10 sm:mt-12">
                    <Link href="/merch">
                        <Button size="lg" variant="coral" className="rounded-full px-8 group">
                            Ver merch oficial
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                        </Button>
                    </Link>
                </div>
            </div>
        </section>
    )
}
