"use client"

import * as React from "react"
import { motion, useReducedMotion, type HTMLMotionProps, type Variants } from "framer-motion"
import { cn } from "@/lib/utils"

type Direction = "up" | "down" | "left" | "right" | "fade"

const distanceFor = (direction: Direction) => {
  switch (direction) {
    case "up": return { y: 24, x: 0 }
    case "down": return { y: -24, x: 0 }
    case "left": return { y: 0, x: 24 }
    case "right": return { y: 0, x: -24 }
    case "fade": return { y: 0, x: 0 }
  }
}

interface MotionSectionProps extends Omit<HTMLMotionProps<"section">, "variants" | "initial" | "whileInView" | "viewport"> {
  direction?: Direction
  delay?: number
  duration?: number
  amount?: number
  once?: boolean
  as?: "section" | "div" | "article" | "header" | "footer" | "ul" | "ol" | "main" | "aside"
}

export function MotionSection({
  direction = "up",
  delay = 0,
  duration = 0.55,
  amount = 0.2,
  once = true,
  className,
  children,
  as = "section",
  ...rest
}: MotionSectionProps) {
  const prefersReducedMotion = useReducedMotion()
  const offset = distanceFor(direction)

  if (prefersReducedMotion) {
    return React.createElement(as, { className: cn(className) }, children as React.ReactNode)
  }

  const Component = motion[as as keyof typeof motion] as typeof motion.section

  return (
    <Component
      className={cn(className)}
      initial={{ opacity: 0, y: offset.y, x: offset.x }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once, amount }}
      transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] as const }}
      {...rest}
    >
      {children}
    </Component>
  )
}

export function MotionStagger({
  children,
  className,
  delay = 0,
  stagger = 0.08,
  amount = 0.2,
  once = true,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
  stagger?: number
  amount?: number
  once?: boolean
}) {
  const prefersReducedMotion = useReducedMotion()
  const variants: Variants = {
    hidden: {},
    visible: {
      transition: { staggerChildren: stagger, delayChildren: delay },
    },
  }
  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, amount }}
    >
      {children}
    </motion.div>
  )
}

export function MotionItem({
  children,
  className,
  direction = "up",
  duration = 0.5,
}: {
  children: React.ReactNode
  className?: string
  direction?: Direction
  duration?: number
}) {
  const prefersReducedMotion = useReducedMotion()
  const offset = distanceFor(direction)
  if (prefersReducedMotion) {
    return <div className={className}>{children}</div>
  }
  const variants: Variants = {
    hidden: { opacity: 0, y: offset.y, x: offset.x },
    visible: {
      opacity: 1,
      y: 0,
      x: 0,
      transition: { duration, ease: [0.16, 1, 0.3, 1] as const },
    },
  }
  return (
    <motion.div className={className} variants={variants}>
      {children}
    </motion.div>
  )
}
