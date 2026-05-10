import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Waves, Home, Calendar } from "lucide-react"

export default function NotFound() {
    return (
        <div className="relative min-h-[80vh] flex items-center justify-center overflow-hidden bg-gradient-to-br from-fdnda-light/40 via-white to-fdnda-light/20 px-4 py-16">
            <div className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-fdnda-accent/15 blur-3xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-coral/15 blur-3xl" aria-hidden="true" />

            <div className="relative max-w-lg text-center">
                <div className="relative inline-flex items-center justify-center mb-6">
                    <div className="absolute inset-0 rounded-full bg-gradient-to-br from-fdnda-accent/30 to-coral/30 blur-3xl" aria-hidden="true" />
                    <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-fdnda-primary to-fdnda-secondary text-white shadow-2xl ring-4 ring-white">
                        <Waves className="h-16 w-16 animate-float" />
                    </div>
                </div>

                <p className="font-display text-7xl sm:text-8xl font-bold text-gradient-coral leading-none mb-2">
                    404
                </p>
                <h1 className="font-display text-2xl sm:text-3xl font-bold mb-3">
                    Te perdiste en el agua
                </h1>
                <p className="text-muted-foreground mb-8 max-w-md mx-auto">
                    La página que buscas no existe o fue movida. No te preocupes, te ayudamos a volver al rumbo.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link href="/">
                        <Button variant="coral" size="lg" className="w-full sm:w-auto rounded-full px-7">
                            <Home className="h-4 w-4" />
                            Volver al inicio
                        </Button>
                    </Link>
                    <Link href="/eventos">
                        <Button variant="outline" size="lg" className="w-full sm:w-auto rounded-full px-7">
                            <Calendar className="h-4 w-4" />
                            Ver eventos
                        </Button>
                    </Link>
                </div>
            </div>
        </div>
    )
}
