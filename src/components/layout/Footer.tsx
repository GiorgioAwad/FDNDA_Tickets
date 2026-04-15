"use client"

import Link from "next/link"
import Image from "next/image"
import { Facebook, Instagram, Mail, MapPin, Phone } from "lucide-react"

export function Footer() {
    return (
        <footer className="bg-gradient-to-br from-[hsl(210,100%,15%)] to-[hsl(210,100%,25%)] text-white">
            <div className="container mx-auto px-4 py-10 sm:py-12">
                <div className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 sm:h-12 sm:w-12">
                                <Image
                                    src="/logo.png"
                                    alt="FDNDA"
                                    width={40}
                                    height={40}
                                    className="h-8 w-8 object-contain sm:h-10 sm:w-10"
                                />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold sm:text-xl">Ticketing FDNDA</h3>
                            </div>
                        </div>
                        <p className="text-sm leading-relaxed text-white/70">
                            Federacion Deportiva Nacional de Deportes Acuaticos del Peru.
                            Promoviendo el deporte acuatico desde 1926.
                        </p>
                    </div>

                    <div>
                        <h4 className="mb-4 font-semibold">Enlaces Rapidos</h4>
                        <ul className="space-y-2 text-sm text-white/70">
                            <li>
                                <Link href="/eventos" className="transition-colors hover:text-white">
                                    Proximos Eventos
                                </Link>
                            </li>
                            <li>
                                <Link href="/mi-cuenta/entradas" className="transition-colors hover:text-white">
                                    Mis Entradas
                                </Link>
                            </li>
                            <li>
                                <Link href="/register" className="transition-colors hover:text-white">
                                    Crear Cuenta
                                </Link>
                            </li>
                            <li>
                                <Link href="/login" className="transition-colors hover:text-white">
                                    Iniciar Sesion
                                </Link>
                            </li>
                        </ul>
                    </div>

                    <div>
                        <h4 className="mb-4 font-semibold">Disciplinas</h4>
                        <ul className="space-y-2 text-sm text-white/70">
                            <li>Natacion</li>
                            <li>Waterpolo</li>
                            <li>Clavados</li>
                            <li>Natacion Artistica</li>
                            <li>Aguas Abiertas</li>
                            <li>Master</li>
                        </ul>
                    </div>

                    <div>
                        <h4 className="mb-4 font-semibold">Contacto</h4>
                        <ul className="space-y-3 text-sm text-white/70">
                            <li className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 flex-shrink-0" />
                                <span>Jr. Nazca Cdra. 6 s/n Lima 11, Peru</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <Phone className="h-4 w-4 flex-shrink-0" />
                                <span>+51 941 632 535</span>
                            </li>
                            <li className="flex items-center gap-2">
                                <Mail className="h-4 w-4 flex-shrink-0" />
                                <span>ticketing@fdnda.org</span>
                            </li>
                        </ul>

                        <div className="mt-4 flex gap-3">
                            <a
                                href="https://www.facebook.com/FDNDeportesAcuaticos/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
                                aria-label="Facebook"
                            >
                                <Facebook className="h-4 w-4" />
                            </a>
                            <a
                                href="https://www.instagram.com/fdndeportesacuaticos"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
                                aria-label="Instagram"
                            >
                                <Instagram className="h-4 w-4" />
                            </a>
                            <a
                                href="https://www.flickr.com/people/199063205@N06/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-full bg-white/10 p-2 transition-colors hover:bg-white/20"
                                aria-label="Flickr"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="7" cy="12" r="5" fill="#0063dc" />
                                    <circle cx="17" cy="12" r="5" fill="#ff0084" />
                                </svg>
                            </a>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-center text-sm text-white/50 md:flex-row md:text-left">
                    <p>&copy; {new Date().getFullYear()} Ticketing FDNDA. Todos los derechos reservados.</p>
                    <div className="flex flex-wrap justify-center gap-3 md:justify-end md:gap-4">
                        <Link href="/libro-de-reclamaciones" className="transition-colors hover:text-white">
                            Libro de Reclamaciones
                        </Link>
                        <Link href="/terminos" className="transition-colors hover:text-white">
                            Terminos y Condiciones
                        </Link>
                        <Link href="/privacidad" className="transition-colors hover:text-white">
                            Politica de Privacidad
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    )
}
