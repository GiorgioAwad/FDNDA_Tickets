import Link from "next/link"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { prisma } from "@/lib/prisma"
import { formatDate, formatPrice } from "@/lib/utils"
import { getCurrentUser } from "@/lib/auth"
import HomeVerificationPopup from "@/components/home/HomeVerificationPopup"
import { EventBannerMedia } from "@/components/events/EventBannerMedia"
import type { Prisma } from "@prisma/client"
import {
  Calendar,
  MapPin,
  ArrowRight,
  Trophy,
  Waves,
  Timer,
  Shield,
} from "lucide-react"

export const revalidate = 60
export const dynamic = "force-dynamic"

type HomeEvent = {
  id: string
  slug: string
  title: string
  bannerUrl?: string | null
  discipline?: string | null
  startDate: Date
  venue: string
  location: string
  ticketTypes: {
    price: Prisma.Decimal
  }[]
  _count: {
    tickets: number
  }
}

async function getUpcomingEvents(): Promise<HomeEvent[]> {
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
          take: 1,
        },
        _count: {
          select: { tickets: true },
        },
      },
      orderBy: { startDate: "asc" },
      take: 6,
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

type HomePageProps = {
  searchParams?: Promise<{
    verified?: string
  }>
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [events, user] = await Promise.all([
    getUpcomingEvents(),
    getSafeCurrentUser(),
  ])
  const showRegister = !user
  const params = searchParams ? await searchParams : undefined
  const showVerificationPopup = params?.verified === "1"

  return (
    <div className="flex flex-col">
      <HomeVerificationPopup open={showVerificationPopup} />
      {/* Hero Section */}
      <section className="relative flex min-h-[72vh] items-center justify-center overflow-hidden sm:min-h-[80vh] lg:min-h-[85vh]">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(210,100%,20%)] via-[hsl(210,100%,30%)] to-[hsl(200,100%,40%)]" />

        {/* Animated waves pattern */}
        <div className="absolute inset-0 opacity-10">
          <svg
            className="absolute bottom-0 w-full"
            viewBox="0 0 1440 320"
            preserveAspectRatio="none"
          >
            <path
              fill="white"
              d="M0,192L48,197.3C96,203,192,213,288,229.3C384,245,480,267,576,250.7C672,235,768,181,864,181.3C960,181,1056,235,1152,234.7C1248,235,1344,181,1392,154.7L1440,128L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
            />
          </svg>
        </div>

        {/* Content */}
        <div className="container mx-auto px-4 py-16 relative z-10 text-center text-white sm:py-20">
          <div className="inline-flex max-w-full items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur-sm mb-5 sm:mb-6 sm:gap-2 sm:px-4 sm:py-2">
            <Image
              src="/logo.png"
              alt="FDNDA"
              width={20}
              height={20}
              className="h-4 w-4 object-contain sm:h-5 sm:w-5"
              priority
            />
            <Waves className="h-4 w-4 sm:h-5 sm:w-5" />
            <span className="text-[11px] font-semibold tracking-wide sm:text-[13px]">
              {"Federaci\u00f3n Deportiva Nacional de Deportes Acu\u00e1ticos"}
            </span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold mb-4 sm:mb-6 leading-tight">
            Vive la Emoción del
            <br />
            <span className="text-[hsl(var(--fdnda-accent))]">Deporte Acuático</span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-white/80 max-w-2xl mx-auto mb-6 sm:mb-8 px-2 sm:px-0">
            Compra tus entradas para los mejores eventos de natación, waterpolo,
            clavados y más. Experiencias únicas que no puedes perderte.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/eventos">
              <Button size="xl" className="w-full sm:w-auto bg-white text-[hsl(210,100%,25%)] hover:bg-white/90 gap-2">
                Ver Eventos
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
            {showRegister && (
              <Link href="/register">
                <Button
                  size="xl"
                  variant="outline"
                  className="w-full sm:w-auto border-white text-white bg-transparent hover:bg-white/10 hover:text-white"
                >
                  Crear Cuenta Gratis
                </Button>
              </Link>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mt-10 sm:mt-16 max-w-3xl mx-auto">
            {[
              { label: "Años de Historia", value: "100", icon: Timer },
              { label: "Disciplinas", value: "6", icon: Trophy },
              { label: "Año de Fundación", value: "1926", icon: Calendar },
              { label: "Plataforma Oficial", value: "1", icon: Shield },
            ].map((stat) => (
              <div key={stat.label} className="p-3 sm:p-4 rounded-xl bg-white/10 backdrop-blur-sm">
                <stat.icon className="h-5 w-5 sm:h-6 sm:w-6 mb-2 mx-auto text-[hsl(var(--fdnda-accent))]" />
                <div className="text-xl sm:text-2xl md:text-3xl font-bold">{stat.value}</div>
                <div className="text-xs sm:text-sm text-white/70">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Upcoming Events Section */}
      <section className="py-14 sm:py-20 bg-gradient-to-b from-white to-gray-50">
        <div className="container mx-auto px-4">
          <div className="text-center mb-8 sm:mb-12">
            <Badge variant="info" className="mb-4">Próximamente</Badge>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Próximos Eventos
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              No te pierdas los eventos más esperados del año. Compra tus entradas
              con anticipación y asegura tu lugar.
            </p>
          </div>

          {events.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((event: HomeEvent) => (
                <Link key={event.id} href={`/eventos/${event.slug}`}>
                  <Card hover className="h-full overflow-hidden group">
                    {/* Event image placeholder */}
                    <div className="relative h-48 bg-gradient-fdnda overflow-hidden">
                      {event.bannerUrl ? (
                        <EventBannerMedia
                          src={event.bannerUrl}
                          alt={event.title}
                          sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Waves className="h-16 w-16 text-white/30" />
                        </div>
                      )}
                      {event.discipline && (
                        <Badge className="absolute top-3 left-3 bg-white/90 text-gray-800">
                          {event.discipline}
                        </Badge>
                      )}
                    </div>

                    <CardContent className="p-4 sm:p-5">
                      <h3 className="font-bold text-lg mb-2 line-clamp-2 group-hover:text-[hsl(210,100%,40%)] transition-colors">
                        {event.title}
                      </h3>

                      <div className="space-y-2 text-sm text-gray-600 mb-4">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-gray-400" />
                          <span>{formatDate(event.startDate)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-gray-400" />
                          <span className="line-clamp-1">{event.venue}, {event.location}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t">
                        <div>
                          {event.ticketTypes[0] && (
                            <div className="text-[hsl(210,100%,40%)] font-bold">
                              Desde {formatPrice(Number(event.ticketTypes[0].price))}
                            </div>
                          )}
                        </div>
                        <Button size="sm" variant="outline" className="gap-1">
                          Ver más
                          <ArrowRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Waves className="h-16 w-16 mx-auto text-gray-300 mb-4" />
              <h3 className="text-xl font-semibold text-gray-600 mb-2">
                No hay eventos próximos
              </h3>
              <p className="text-gray-500">
                Pronto anunciaremos nuevos eventos. ¡Mantente atento!
              </p>
            </div>
          )}

          {events.length > 0 && (
            <div className="text-center mt-8 sm:mt-10">
              <Link href="/eventos">
                <Button size="lg" variant="outline" className="gap-2">
                  Ver todos los eventos
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          )}
        </div>
      </section>

            {/* CTA Section */}
      {showRegister && (
        <section className="py-12 sm:py-16 bg-gradient-fdnda">
          <div className="container mx-auto px-4 text-center text-white">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-4">
              {"\u00bfListo para vivir la experiencia?"}
            </h2>
            <p className="text-sm sm:text-base text-white/80 mb-8 max-w-xl mx-auto">
              Crea tu cuenta gratis y accede a todos los eventos de la FDNDA.
            </p>
            <Link href="/register">
              <Button size="xl" className="w-full sm:w-auto bg-white text-[hsl(210,100%,25%)] hover:bg-white/90">
                Crear Cuenta Gratis
              </Button>
            </Link>
          </div>
        </section>
      )}
    </div>
  )
}

