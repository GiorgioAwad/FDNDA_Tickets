"use client"

import Link from "next/link"
import Image from "next/image"
import { Facebook, Instagram, Mail, Phone, MapPin } from "lucide-react"

export function Footer() {
    return (
        <footer className="bg-gradient-to-br from-[hsl(210,100%,15%)] to-[hsl(210,100%,25%)] text-white">
            <div className="container mx-auto px-4 py-12">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                    {/* Brand */}
                    <div className="space-y-4">
                        <div className="flex items-center gap-2">
                            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                                <Image
                                    src="/logo.png"
                                    alt="FDNDA"
                                    width={40}
                                    height={40}
                                    className="h-10 w-10 object-contain"
                                />
                            </div>
                            <div>
                                <h3 className="font-bold text-xl">Ticketing FDNDA</h3>
                            </div>
                        </div>
                        <p className="text-sm text-white/70 leading-relaxed">
                            Federación Deportiva Nacional de Deportes Acuáticos del Perú.
                            Promoviendo el deporte acuático desde 1926.
                        </p>
                    </div>

                    {/* Quick Links */}
                    <div>
                        <h4 className="font-semibold mb-4">Enlaces Rápidos</h4>
                        <ul className="space-y-2 text-sm text-white/70">
                            <li>
                                <Link href="/eventos" className="hover:text-white transition-colors">
                                    Próximos Eventos
                                </Link>
                            </li>
                            <li>
                                <Link href="/mi-cuenta/entradas" className="hover:text-white transition-colors">
                                    Mis Entradas
                                </Link>
                            </li>
                            <li>
                                <Link href="/register" className="hover:text-white transition-colors">
                                    Crear Cuenta
                                </Link>
                            </li>
                            <li>
                                <Link href="/login" className="hover:text-white transition-colors">
                                    Iniciar Sesión
                                </Link>
                            </li>
                        </ul>
                    </div>

                    {/* Disciplines */}
                    <div>
                        <h4 className="font-semibold mb-4">Disciplinas</h4>
                        <ul className="space-y-2 text-sm text-white/70">
                            <li>Natación</li>
                            <li>Waterpolo</li>
                            <li>Clavados</li>
                            <li>Natación Artística</li>
                            <li>Aguas Abiertas</li>
                        </ul>
                    </div>

                    {/* Contact */}
                    <div>
                        <h4 className="font-semibold mb-4">Contacto</h4>
                        <ul className="space-y-3 text-sm text-white/70">
                            <li className="flex items-center gap-2">
                                <MapPin className="h-4 w-4 flex-shrink-0" />
                                <span>Jr. Nazca Cdra. 6 s/n Lima 11, Perú</span>
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

                        {/* Social */}
                        <div className="flex gap-3 mt-4">
                            <a
                                href="https://www.facebook.com/FDNDeportesAcuaticos/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                aria-label="Facebook"
                            >
                                <Facebook className="h-4 w-4" />
                            </a>
                            <a
                                href="https://www.instagram.com/fdndeportesacuaticos"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
                                aria-label="Instagram"
                            >
                                <Instagram className="h-4 w-4" />
                            </a>
                            <a
                                href="https://www.flickr.com/people/199063205@N06/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
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

                {/* Bottom bar */}
                <div className="mt-8 pt-8 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-white/50">
                    <p>© {new Date().getFullYear()} Ticketing FDNDA. Todos los derechos reservados.</p>
                    <div className="flex gap-4">
                        <Link href="/terminos" className="hover:text-white transition-colors">
                            Términos y Condiciones
                        </Link>
                        <Link href="/privacidad" className="hover:text-white transition-colors">
                            Política de Privacidad
                        </Link>
                    </div>
                </div>
            </div>
        </footer>
    )
}
