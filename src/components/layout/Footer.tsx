import Link from "next/link"
import Image from "next/image"
import { Facebook, Instagram, Mail, MapPin, Phone } from "lucide-react"

const disciplines = [
    { name: "Natación", slug: "natacion" },
    { name: "Waterpolo", slug: "waterpolo" },
    { name: "Clavados", slug: "clavados" },
    { name: "Natación Artística", slug: "natacion-artistica" },
    { name: "Aguas Abiertas", slug: "aguas-abiertas" },
    { name: "Master", slug: "master" },
]

export function Footer() {
    return (
        <footer className="relative overflow-hidden bg-gradient-to-br from-[hsl(210,100%,12%)] via-[hsl(210,100%,18%)] to-[hsl(210,100%,22%)] text-white">
            {/* Coral accent glow */}
            <div className="pointer-events-none absolute -bottom-40 -right-20 h-80 w-80 rounded-full bg-coral/15 blur-3xl" aria-hidden="true" />
            <div className="pointer-events-none absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-fdnda-accent/15 blur-3xl" aria-hidden="true" />

            <div className="relative container mx-auto px-4 py-12 sm:py-14">
                <div className="grid grid-cols-1 gap-8 sm:gap-10 md:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-4">
                        <Link href="/" className="flex items-center gap-3 group">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20 group-hover:scale-105 transition-transform">
                                <Image src="/logo.png" alt="FDNDA" width={40} height={40} className="h-9 w-9 object-contain" />
                            </div>
                            <div>
                                <h3 className="font-display text-xl font-bold leading-tight">Ticketing FDNDA</h3>
                                <p className="text-xs text-white/60">Plataforma oficial</p>
                            </div>
                        </Link>
                        <p className="text-sm leading-relaxed text-white/70">
                            Federación Deportiva Nacional de Deportes Acuáticos del Perú. Promoviendo el deporte acuático desde 1926.
                        </p>
                        <div className="flex gap-2 pt-1">
                            <SocialButton href="https://www.facebook.com/FDNDeportesAcuaticos/" label="Facebook" hoverColor="hover:bg-[#1877F2]">
                                <Facebook className="h-4 w-4" />
                            </SocialButton>
                            <SocialButton href="https://www.instagram.com/fdndeportesacuaticos" label="Instagram" hoverColor="hover:bg-gradient-to-br hover:from-[#833AB4] hover:via-[#FD1D1D] hover:to-[#FCB045]">
                                <Instagram className="h-4 w-4" />
                            </SocialButton>
                            <SocialButton href="https://www.flickr.com/people/199063205@N06/" label="Flickr" hoverColor="hover:bg-[#0063dc]">
                                <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="7" cy="12" r="5" fill="currentColor" />
                                    <circle cx="17" cy="12" r="5" fill="#ff0084" />
                                </svg>
                            </SocialButton>
                        </div>
                    </div>

                    <div>
                        <h4 className="mb-4 font-display font-semibold text-white">Enlaces rápidos</h4>
                        <ul className="space-y-2.5 text-sm text-white/70">
                            <FooterLink href="/eventos">Próximos eventos</FooterLink>
                            <FooterLink href="/mi-cuenta/entradas">Mis entradas</FooterLink>
                            <FooterLink href="/canjear">Canjear cortesía</FooterLink>
                            <FooterLink href="/register">Crear cuenta</FooterLink>
                            <FooterLink href="/login">Iniciar sesión</FooterLink>
                        </ul>
                    </div>

                    <div>
                        <h4 className="mb-4 font-display font-semibold text-white">Disciplinas</h4>
                        <ul className="space-y-2.5 text-sm text-white/70">
                            {disciplines.map((d) => (
                                <li key={d.slug}>
                                    <Link
                                        href={`/eventos?discipline=${encodeURIComponent(d.name)}`}
                                        className="inline-flex items-center gap-1.5 transition-colors hover:text-white hover:translate-x-0.5 transform duration-200"
                                    >
                                        {d.name}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div>
                        <h4 className="mb-4 font-display font-semibold text-white">Contacto</h4>
                        <ul className="space-y-3 text-sm text-white/70">
                            <li className="flex items-start gap-2.5">
                                <MapPin className="h-4 w-4 flex-shrink-0 mt-0.5 text-fdnda-accent" />
                                <span>Jr. Nazca Cdra. 6 s/n, Lima 11, Perú</span>
                            </li>
                            <li className="flex items-center gap-2.5">
                                <Phone className="h-4 w-4 flex-shrink-0 text-fdnda-accent" />
                                <a href="tel:+51941632535" className="hover:text-white transition-colors">+51 941 632 535</a>
                            </li>
                            <li className="flex items-center gap-2.5">
                                <Mail className="h-4 w-4 flex-shrink-0 text-fdnda-accent" />
                                <a href="mailto:ticketing@fdnda.org" className="hover:text-white transition-colors">ticketing@fdnda.org</a>
                            </li>
                        </ul>
                    </div>
                </div>

                <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-center text-sm text-white/50 md:flex-row md:text-left">
                    <p>
                        &copy; {new Date().getFullYear()} Ticketing FDNDA. Todos los derechos reservados.
                    </p>
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 md:justify-end">
                        <Link href="/libro-de-reclamaciones" className="transition-colors hover:text-white">
                            Libro de reclamaciones
                        </Link>
                        <Link href="/terminos" className="transition-colors hover:text-white">
                            Términos y condiciones
                        </Link>
                        <Link href="/privacidad" className="transition-colors hover:text-white">
                            Política de privacidad
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    )
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
    return (
        <li>
            <Link
                href={href}
                className="inline-flex items-center gap-1.5 transition-all duration-200 hover:text-white hover:translate-x-0.5"
            >
                {children}
            </Link>
        </li>
    )
}

function SocialButton({
    href,
    label,
    hoverColor,
    children,
}: {
    href: string
    label: string
    hoverColor: string
    children: React.ReactNode
}) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15 transition-all duration-300 hover:scale-110 hover:ring-white/40 ${hoverColor}`}
        >
            {children}
        </a>
    )
}
