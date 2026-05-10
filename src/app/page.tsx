import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"
import { getCurrentUser } from "@/lib/auth"
import HomeVerificationPopup from "@/components/home/HomeVerificationPopup"
import { HeroSection } from "@/components/home/HeroSection"
import { EventCard, type EventCardEvent } from "@/components/home/EventCard"
import { FeaturedEvent } from "@/components/home/FeaturedEvent"
import { DisciplinesGrid } from "@/components/home/DisciplinesGrid"
import { HowItWorks } from "@/components/home/HowItWorks"
import { EmptyState } from "@/components/ui/empty-state"
import { MotionSection, MotionStagger, MotionItem } from "@/components/ui/motion-section"
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react"

export const revalidate = 60
export const dynamic = "force-dynamic"

type RawEvent = Awaited<ReturnType<typeof getUpcomingEvents>>[number]

async function getUpcomingEvents() {
  try {
    const events = await prisma.event.findMany({
      where: {
        isPublished: true,
        visibility: "PUBLIC",
        endDate: { gte: new Date() },
      },
      include: {
        ticketTypes: {
          where: { isActive: true },
          orderBy: { price: "asc" },
        },
        _count: {
          select: { tickets: true },
        },
      },
      orderBy: { startDate: "asc" },
      take: 7,
    })
    return events
  } catch (error) {
    console.error("Failed to load upcoming events for home page", error)
    return []
  }
}

async function getSafeCurrentUser() {
  try {
    return await getCurrentUser()
  } catch (error) {
    console.error("Failed to resolve current user for home page", error)
    return null
  }
}

function toCardEvent(event: RawEvent): EventCardEvent & { description?: string | null } {
  const minPrice = event.ticketTypes[0]?.price ? Number(event.ticketTypes[0].price) : undefined
  const capacity = event.ticketTypes.reduce((sum, tt) => sum + (tt.capacity ?? 0), 0)
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    bannerUrl: event.bannerUrl,
    discipline: event.discipline,
    startDate: event.startDate,
    venue: event.venue,
    location: event.location,
    minPrice,
    soldCount: event._count.tickets,
    capacity: capacity > 0 ? capacity : undefined,
    description: event.description ?? null,
  }
}

type HomePageProps = {
  searchParams?: Promise<{
    verified?: string
  }>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [rawEvents, user] = await Promise.all([
    getUpcomingEvents(),
    getSafeCurrentUser(),
  ])
  const cardEvents = rawEvents.map(toCardEvent)
  const showRegister = !user
  const params = searchParams ? await searchParams : undefined
  const showVerificationPopup = params?.verified === "1"

  const featured = cardEvents[0]
  const restEvents = cardEvents.slice(1, 7)

  return (
    <div className="flex flex-col">
      <HomeVerificationPopup open={showVerificationPopup} />

      <HeroSection showRegister={showRegister} />

      {/* Featured + Upcoming */}
      <section className="py-14 sm:py-20 bg-gradient-to-b from-white to-gray-50">
        <div className="container mx-auto px-4">
          <MotionSection className="text-center mb-10 sm:mb-12">
            <Badge variant="info" className="mb-3">
              <Sparkles className="h-3 w-3 mr-1" />Próximamente
            </Badge>
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3">
              Próximos eventos
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              No te pierdas los eventos más esperados del año. Asegura tu lugar con anticipación.
            </p>
          </MotionSection>

          {featured && (
            <div className="mb-8 sm:mb-12">
              <FeaturedEvent event={featured} />
            </div>
          )}

          {restEvents.length > 0 ? (
            <MotionStagger
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6"
              stagger={0.08}
            >
              {restEvents.map((event) => (
                <MotionItem key={event.id}>
                  <EventCard event={event} />
                </MotionItem>
              ))}
            </MotionStagger>
          ) : !featured ? (
            <EmptyState
              variant="no-events"
              title="Pronto, nuevos eventos"
              description="Estamos preparando experiencias únicas para ti. Mantente atento."
              action={{ label: "Crear cuenta", href: "/register", variant: "coral" }}
            />
          ) : null}

          {cardEvents.length > 0 && (
            <div className="text-center mt-10 sm:mt-12">
              <Link href="/eventos">
                <Button size="lg" variant="outline" className="rounded-full px-8 group">
                  Ver todos los eventos
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </section>

      <DisciplinesGrid />

      <HowItWorks />

      {/* Trust band */}
      <section className="py-10 sm:py-12 bg-gradient-to-r from-fdnda-light/40 via-white to-fdnda-light/40 border-y border-border">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 items-center text-center">
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="h-6 w-6 text-fdnda-secondary" />
              <p className="text-xs sm:text-sm font-semibold">Pago 100% seguro</p>
              <p className="text-[10px] text-muted-foreground">Izipay & Visa</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Sparkles className="h-6 w-6 text-coral" />
              <p className="text-xs sm:text-sm font-semibold">QR instantáneo</p>
              <p className="text-[10px] text-muted-foreground">Tu entrada al toque</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <ShieldCheck className="h-6 w-6 text-fdnda-secondary" />
              <p className="text-xs sm:text-sm font-semibold">Plataforma oficial</p>
              <p className="text-[10px] text-muted-foreground">FDNDA Perú</p>
            </div>
            <div className="flex flex-col items-center gap-1">
              <Sparkles className="h-6 w-6 text-coral" />
              <p className="text-xs sm:text-sm font-semibold">Soporte humano</p>
              <p className="text-[10px] text-muted-foreground">WhatsApp directo</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      {showRegister && (
        <section className="relative overflow-hidden py-16 sm:py-20 bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary text-white">
          <div className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-coral/30 blur-3xl" aria-hidden="true" />
          <div className="absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-fdnda-accent/20 blur-3xl" aria-hidden="true" />
          <div className="relative container mx-auto px-4 text-center">
            <h2 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold mb-4">
              ¿Listo para vivir la experiencia?
            </h2>
            <p className="text-white/85 mb-8 max-w-xl mx-auto">
              Crea tu cuenta gratis y accede a todos los eventos oficiales de la FDNDA.
            </p>
            <Link href="/register">
              <Button size="xl" variant="coral" className="rounded-full px-10">
                Crear cuenta gratis
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}
