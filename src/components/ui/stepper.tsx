"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Step {
  id: string
  label: string
  description?: string
}

interface StepperProps {
  steps: Step[]
  current: number
  className?: string
  onStepClick?: (index: number) => void
}

export function Stepper({ steps, current, className, onStepClick }: StepperProps) {
  return (
    <ol className={cn("flex w-full items-start justify-between gap-2", className)}>
      {steps.map((step, idx) => {
        const isCompleted = idx < current
        const isCurrent = idx === current
        const isClickable = !!onStepClick && idx <= current
        return (
          <li key={step.id} className="flex flex-1 items-start">
            <div className="flex flex-1 flex-col items-center text-center">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(idx)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2 font-semibold text-sm transition-all duration-300",
                  isCompleted && "bg-success text-white border-success",
                  isCurrent && "bg-fdnda-primary text-white border-fdnda-primary shadow-glow-primary scale-110",
                  !isCompleted && !isCurrent && "bg-white text-muted-foreground border-border",
                  isClickable && "cursor-pointer hover:scale-105"
                )}
                aria-current={isCurrent ? "step" : undefined}
              >
                {isCompleted ? <Check className="h-5 w-5" /> : idx + 1}
              </button>
              <div className="mt-2 px-1">
                <p
                  className={cn(
                    "text-xs sm:text-sm font-medium leading-tight",
                    isCurrent ? "text-fdnda-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                {step.description && (
                  <p className="hidden sm:block text-[11px] text-muted-foreground mt-0.5">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
            {idx < steps.length - 1 && (
              <div className="flex-1 pt-5 px-1">
                <div
                  className={cn(
                    "h-1 rounded-full transition-all duration-500",
                    isCompleted ? "bg-success" : "bg-border"
                  )}
                />
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
