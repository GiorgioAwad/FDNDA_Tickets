"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { motion, useMotionValue, useTransform, animate } from "framer-motion"
import { RotateCw } from "lucide-react"

interface MerchSpinPreviewProps {
    imageUrl: string | null
    alt: string
    bgClass?: string
}

export function MerchSpinPreview({ imageUrl, alt, bgClass = "bg-gradient-to-br from-fdnda-light/50 via-white to-coral/10" }: MerchSpinPreviewProps) {
    const rotation = useMotionValue(-180)
    const [hint, setHint] = useState(true)
    const dragStartX = useRef<number | null>(null)
    const dragStartRotation = useRef(0)
    const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const autoSpinControls = useRef<ReturnType<typeof animate> | null>(null)

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

        const hintTimer = setTimeout(() => setHint(false), 4000)

        return () => {
            controls.stop()
            clearTimeout(hintTimer)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

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

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        stopAutoSpin()
        if (idleTimer.current) clearTimeout(idleTimer.current)
        setHint(false)
        dragStartX.current = event.clientX
        dragStartRotation.current = rotation.get()
        ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    }

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStartX.current === null) return
        const deltaX = event.clientX - dragStartX.current
        const deltaDeg = deltaX * 0.6
        rotation.set(dragStartRotation.current + deltaDeg)
    }

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (dragStartX.current === null) return
        dragStartX.current = null
        ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
        scheduleAutoSpin()
    }

    return (
        <div className={`relative w-full h-full overflow-hidden rounded-2xl ${bgClass}`}>
            <div
                className="relative w-full h-full select-none cursor-grab active:cursor-grabbing touch-none"
                style={{ perspective: "1400px" }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <motion.div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{
                        transform,
                        transformStyle: "preserve-3d",
                        backfaceVisibility: "visible",
                    }}
                >
                    {imageUrl ? (
                        <div className="relative w-[85%] h-[85%]">
                            <Image
                                src={imageUrl}
                                alt={alt}
                                fill
                                draggable={false}
                                className="object-contain drop-shadow-2xl pointer-events-none"
                                sizes="(max-width: 768px) 90vw, 50vw"
                                priority
                            />
                        </div>
                    ) : (
                        <div className="text-muted-foreground text-sm">Sin imagen</div>
                    )}
                </motion.div>

                {/* Reflection / glow under the product */}
                <motion.div
                    aria-hidden
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 h-3 w-[55%] rounded-full bg-black blur-md"
                    style={{ opacity: shadowOpacity }}
                />
            </div>

            {/* Drag hint */}
            {hint && (
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: 1.4 }}
                    className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm"
                >
                    <RotateCw className="h-3 w-3" />
                    Desliza para girar
                </motion.div>
            )}
        </div>
    )
}
