"use client"

import * as React from "react"
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface KpiCardProps {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
  delta?: number
  deltaLabel?: string
  hint?: string
  tone?: "primary" | "coral" | "accent" | "success" | "warning" | "neutral"
  className?: string
  children?: React.ReactNode
}

const toneMap: Record<NonNullable<KpiCardProps["tone"]>, { iconBg: string; iconText: string; ring: string }> = {
  primary: { iconBg: "bg-fdnda-primary/10", iconText: "text-fdnda-primary", ring: "ring-fdnda-primary/10" },
  coral: { iconBg: "bg-coral/10", iconText: "text-coral-strong", ring: "ring-coral/10" },
  accent: { iconBg: "bg-fdnda-accent/15", iconText: "text-fdnda-accent", ring: "ring-fdnda-accent/10" },
  success: { iconBg: "bg-success/10", iconText: "text-success", ring: "ring-success/10" },
  warning: { iconBg: "bg-warning/10", iconText: "text-warning", ring: "ring-warning/10" },
  neutral: { iconBg: "bg-muted", iconText: "text-muted-foreground", ring: "ring-border" },
}

export function KpiCard({
  label,
  value,
  icon,
  delta,
  deltaLabel,
  hint,
  tone = "primary",
  className,
  children,
}: KpiCardProps) {
  const t = toneMap[tone]
  const trend = delta == null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat"
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus
  const trendColor =
    trend === "up" ? "text-success bg-success/10" : trend === "down" ? "text-coral bg-coral/10" : "text-muted-foreground bg-muted"

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-6 ring-1 transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5",
        t.ring,
        className
      )}
    >
      <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-card-glow opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs sm:text-sm font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          <p className="font-display text-2xl sm:text-3xl font-bold text-foreground mt-1.5 tabular-nums">
            {value}
          </p>
          {hint && (
            <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>
          )}
        </div>
        {icon && (
          <div className={cn("flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5 sm:[&_svg]:h-6 sm:[&_svg]:w-6", t.iconBg, t.iconText)}>
            {icon}
          </div>
        )}
      </div>
      {(delta != null || deltaLabel) && (
        <div className="relative mt-4 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              trendColor
            )}
          >
            <TrendIcon className="h-3 w-3" />
            {delta != null ? `${delta > 0 ? "+" : ""}${delta}%` : ""}
          </span>
          {deltaLabel && (
            <span className="text-xs text-muted-foreground">{deltaLabel}</span>
          )}
        </div>
      )}
      {children && <div className="relative mt-4">{children}</div>}
    </div>
  )
}
