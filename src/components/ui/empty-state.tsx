import * as React from "react"
import Link from "next/link"
import { Inbox, SearchX, AlertTriangle, Ticket, Waves, Compass } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Variant = "no-events" | "no-tickets" | "no-results" | "error" | "404" | "generic"

const variantConfig: Record<Variant, { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  "no-events": { icon: Waves, tone: "from-fdnda-accent/30 to-fdnda-secondary/20" },
  "no-tickets": { icon: Ticket, tone: "from-fdnda-secondary/20 to-coral/20" },
  "no-results": { icon: SearchX, tone: "from-muted-foreground/20 to-muted-foreground/10" },
  error: { icon: AlertTriangle, tone: "from-coral/30 to-coral/10" },
  "404": { icon: Compass, tone: "from-fdnda-accent/30 to-fdnda-primary/20" },
  generic: { icon: Inbox, tone: "from-muted-foreground/20 to-muted-foreground/10" },
}

type Action = {
  label: string
  href?: string
  onClick?: () => void
  variant?: "default" | "outline" | "coral" | "ghost"
}

interface EmptyStateProps {
  variant?: Variant
  title: string
  description?: string
  action?: Action
  secondaryAction?: Action
  className?: string
  icon?: React.ComponentType<{ className?: string }>
}

export function EmptyState({
  variant = "generic",
  title,
  description,
  action,
  secondaryAction,
  className,
  icon: IconOverride,
}: EmptyStateProps) {
  const cfg = variantConfig[variant]
  const Icon = IconOverride ?? cfg.icon
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-16 sm:py-20 animate-fade-up",
        className
      )}
    >
      <div
        className={cn(
          "relative flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br mb-6",
          cfg.tone
        )}
      >
        <span className="absolute inset-0 rounded-full bg-white/40 blur-2xl" aria-hidden="true" />
        <Icon className="relative h-10 w-10 text-fdnda-primary" />
      </div>
      <h3 className="font-display text-xl sm:text-2xl font-bold text-foreground mb-2">
        {title}
      </h3>
      {description && (
        <p className="max-w-md text-sm sm:text-base text-muted-foreground mb-6">
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex flex-col sm:flex-row gap-3">
          {action && <ActionButton action={action} />}
          {secondaryAction && <ActionButton action={secondaryAction} />}
        </div>
      )}
    </div>
  )
}

function ActionButton({ action }: { action: Action }) {
  const button = (
    <Button variant={action.variant ?? "default"} onClick={action.onClick}>
      {action.label}
    </Button>
  )
  return action.href ? <Link href={action.href}>{button}</Link> : button
}
