import * as React from "react"
import { cn } from "@/lib/utils"

type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  rounded?: "sm" | "md" | "lg" | "xl" | "2xl" | "full"
}

const roundedMap: Record<NonNullable<SkeletonProps["rounded"]>, string> = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  "2xl": "rounded-2xl",
  full: "rounded-full",
}

export function Skeleton({ className, rounded = "lg", ...props }: SkeletonProps) {
  return (
    <div
      className={cn("shimmer", roundedMap[rounded], className)}
      aria-hidden="true"
      {...props}
    />
  )
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          rounded="md"
          className={cn("h-3", i === lines - 1 ? "w-3/4" : "w-full")}
        />
      ))}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
      <Skeleton rounded="md" className="h-48 rounded-none" />
      <div className="p-5 space-y-3">
        <Skeleton rounded="md" className="h-5 w-3/4" />
        <SkeletonText lines={2} />
        <div className="flex items-center justify-between pt-2">
          <Skeleton rounded="md" className="h-6 w-20" />
          <Skeleton rounded="md" className="h-9 w-24" />
        </div>
      </div>
    </div>
  )
}
