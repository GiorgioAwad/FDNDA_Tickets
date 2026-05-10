"use client"

import * as React from "react"
import {
  motion,
  useInView,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
} from "framer-motion"
import { cn } from "@/lib/utils"

interface StatCounterProps {
  value: number
  duration?: number
  className?: string
  decimals?: number
  prefix?: string
  suffix?: string
  format?: (n: number) => string
}

export function StatCounter({
  value,
  duration = 1.6,
  className,
  decimals = 0,
  prefix = "",
  suffix = "",
  format,
}: StatCounterProps) {
  const ref = React.useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const prefersReducedMotion = useReducedMotion()
  const motionValue = useMotionValue(0)
  const rounded = useTransform(motionValue, (latest) => {
    if (format) return format(latest)
    return `${prefix}${latest.toFixed(decimals)}${suffix}`
  })

  React.useEffect(() => {
    if (!inView) return
    if (prefersReducedMotion) {
      motionValue.set(value)
      return
    }
    const controls = animate(motionValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1] as const,
    })
    return () => controls.stop()
  }, [inView, value, duration, motionValue, prefersReducedMotion])

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      <motion.span>{rounded}</motion.span>
    </span>
  )
}
