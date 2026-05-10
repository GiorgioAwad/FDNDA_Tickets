"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface Bubble {
  id: number
  size: number
  left: number
  delay: number
  duration: number
}

interface FloatingBubblesProps {
  count?: number
  className?: string
  color?: string
}

export function FloatingBubbles({
  count = 14,
  className,
  color = "rgba(255,255,255,0.18)",
}: FloatingBubblesProps) {
  const [bubbles, setBubbles] = React.useState<Bubble[]>([])

  React.useEffect(() => {
    const next: Bubble[] = Array.from({ length: count }).map((_, i) => ({
      id: i,
      size: 12 + Math.random() * 56,
      left: Math.random() * 100,
      delay: Math.random() * 8,
      duration: 6 + Math.random() * 8,
    }))
    setBubbles(next)
  }, [count])

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden", className)}
      aria-hidden="true"
    >
      {bubbles.map((b) => (
        <span
          key={b.id}
          className="absolute bottom-[-10vh] rounded-full animate-bubble"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size,
            background: color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            boxShadow: "inset 0 0 10px rgba(255,255,255,0.3)",
          }}
        />
      ))}
    </div>
  )
}
