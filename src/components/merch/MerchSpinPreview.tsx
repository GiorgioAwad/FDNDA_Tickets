"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useMotionValue, useTransform, animate } from "framer-motion"
import { ShoppingBag } from "lucide-react"

interface MerchSpinPreviewProps {
    imageUrl: string | null
    backImageUrl?: string | null
    alt: string
    bgClass?: string
}

export function MerchSpinPreview({ imageUrl, backImageUrl, alt, bgClass = "bg-gradient-to-br from-fdnda-light/50 via-white to-coral/10" }: MerchSpinPreviewProps) {
    const rotation = useMotionValue(-180)
    const [failedFront, setFailedFront] = useState<string | null>(null)
    const [failedBack, setFailedBack] = useState<string | null>(null)
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const autoSpinControls = useRef<ReturnType<typeof animate> | null>(null)

    const hasTwoSides = Boolean(imageUrl && backImageUrl && backImageUrl !== imageUrl)

    const transform = useTransform(rotation, (deg) => `rotateY(${deg}deg)`)
    const shadowOpacity = useTransform(rotation, (deg) => {
        const normalized = Math.abs(((deg % 360) + 360) % 360 - 180) / 180
        return 0.15 + normalized * 0.25
    })

    useEffect(() => {
        const controls = animate(rotation, 0, {
            type: "spring",
            damping: 16,
            stiffness: 80,
            mass: 0.9,
        })

        return () => {
            controls.stop()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const frontFailed = Boolean(imageUrl && failedFront === imageUrl)
    const backFailed = Boolean(backImageUrl && failedBack === backImageUrl)

    const stopAutoSpin = () => {
        if (autoSpinControls.current) {
            autoSpinControls.current.stop()
            autoSpinControls.current = null
        }
    }

    const scheduleAutoSpin = () => {
        if (idleTimer.current) clearTimeout(idleTimer.current)
        idleTimer.current = setTimeout(() => {
            const current = rotation.get()
            autoSpinControls.current = animate(rotation, current + 360, {
                duration: 8,
                ease: "linear",
                repeat: Infinity,
            })
        }, 3500)
    }

    useEffect(() => {
        scheduleAutoSpin()
        return () => {
            if (idleTimer.current) clearTimeout(idleTimer.current)
            stopAutoSpin()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <div className={`relative w-full h-full overflow-hidden rounded-2xl ${bgClass}`}>
            <div
                className="relative w-full h-full select-none"
                style={{ perspective: "1400px" }}
            >
                <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                        transform,
                        transformStyle: "preserve-3d",
                    }}
                >
                    {imageUrl && !frontFailed ? (
                        <>
                            {/* Frente */}
                            <div
                                className="absolute inset-0 flex items-center justify-center"
                                style={{
                                    transform: "rotateY(0deg)",
                                    backfaceVisibility: hasTwoSides ? "hidden" : "visible",
                                    WebkitBackfaceVisibility: hasTwoSides ? "hidden" : "visible",
                                }}
                            >
                                <div className="relative w-[85%] h-[85%]">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={imageUrl}
                                        alt={alt}
                                        draggable={false}
                                        onError={() => setFailedFront(imageUrl)}
                                        className="h-full w-full object-contain drop-shadow-2xl pointer-events-none"
                                    />
                                </div>
                            </div>

                            {/* Espalda — solo cuando hay backImageUrl distinta */}
                            {hasTwoSides && backImageUrl && !backFailed && (
                                <div
                                    className="absolute inset-0 flex items-center justify-center"
                                    style={{
                                        transform: "rotateY(180deg)",
                                        backfaceVisibility: "hidden",
                                        WebkitBackfaceVisibility: "hidden",
                                    }}
                                >
                                    <div className="relative w-[85%] h-[85%]">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={backImageUrl}
                                            alt={`${alt} (espalda)`}
                                            draggable={false}
                                            onError={() => setFailedBack(backImageUrl)}
                                            className="h-full w-full object-contain drop-shadow-2xl pointer-events-none"
                                        />
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-3 text-fdnda-primary/60">
                            <ShoppingBag className="h-20 w-20" />
                            <span className="text-xs font-semibold uppercase tracking-widest">Merch oficial</span>
                        </div>
                    )}
                </motion.div>

                {/* Reflection / glow under the product */}
                <motion.div
                    aria-hidden
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 h-3 w-[55%] rounded-full bg-black blur-md"
                    style={{ opacity: shadowOpacity }}
                />
            </div>

        </div>
    )
}
