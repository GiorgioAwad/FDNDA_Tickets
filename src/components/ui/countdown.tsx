"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

type Granularity = "days" | "hours" | "minutes" | "seconds"

interface CountdownProps {
  target: Date | string | number
  className?: string
  size?: "sm" | "md" | "lg"
  showLabels?: boolean
  onComplete?: () => void
}

function diff(target: Date) {
  const now = Date.now()
  const ms = Math.max(0, target.getTime() - now)
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24)
  const minutes = Math.floor((ms / (1000 * 60)) % 60)
  const seconds = Math.floor((ms / 1000) % 60)
  return { ms, days, hours, minutes, seconds }
}

const sizeMap = {
  sm: { box: "h-12 w-12 text-lg", label: "text-[10px]" },
  md: { box: "h-16 w-16 text-2xl sm:h-20 sm:w-20 sm:text-3xl", label: "text-xs" },
  lg: { box: "h-20 w-20 text-3xl sm:h-24 sm:w-24 sm:text-4xl", label: "text-xs sm:text-sm" },
}

export function Countdown({
  target,
  className,
  size = "md",
  showLabels = true,
  onComplete,
}: CountdownProps) {
  const targetDate = React.useMemo(() => new Date(target), [target])
  const [time, setTime] = React.useState(() => diff(targetDate))
  const completedRef = React.useRef(false)

  React.useEffect(() => {
    const id = setInterval(() => {
      const next = diff(targetDate)
      setTime(next)
      if (next.ms === 0 && !completedRef.current) {
        completedRef.current = true
        onComplete?.()
      }
    }, 1000)
    return () => clearInterval(id)
  }, [targetDate, onComplete])

  const sz = sizeMap[size]
  const items: { value: number; label: string; key: Granularity }[] = [
    { value: time.days, label: "Días", key: "days" },
    { value: time.hours, label: "Hrs", key: "hours" },
    { value: time.minutes, label: "Min", key: "minutes" },
    { value: time.seconds, label: "Seg", key: "seconds" },
  ]

  return (
    <div
      className={cn("flex items-center gap-2 sm:gap-3", className)}
      role="timer"
      aria-label="Cuenta regresiva del evento"
    >
      {items.map((item, idx) => (
        <React.Fragment key={item.key}>
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-sm border border-white/15 font-display font-bold text-white tabular-nums shadow-lg",
                sz.box
              )}
            >
              {String(item.value).padStart(2, "0")}
            </div>
            {showLabels && (
              <span className={cn("mt-1.5 uppercase tracking-wider text-white/70", sz.label)}>
                {item.label}
              </span>
            )}
          </div>
          {idx < items.length - 1 && (
            <span className="font-display font-bold text-white/50 text-2xl sm:text-3xl pb-5">:</span>
          )}
        </React.Fragment>
      ))}
    </div>
  )
}
