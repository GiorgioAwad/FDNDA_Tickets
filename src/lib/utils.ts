import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

export function formatPrice(amount: number | string, currency: string = "PEN"): string {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount
    return new Intl.NumberFormat("es-PE", {
        style: "currency",
        currency: currency,
    }).format(numAmount)
}

function parseDateInput(date: Date | string): Date {
    if (date instanceof Date) return date
    if (typeof date === "string") {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
        if (match) {
            const [, year, month, day] = match
            return new Date(Number(year), Number(month) - 1, Number(day))
        }
    }
    return new Date(date)
}

export function parseDateOnly(date: Date | string): Date {
    return parseDateInput(date)
}

export function formatDateInput(date: Date | string): string {
    const d = parseDateInput(date)
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

export function formatDate(date: Date | string, options?: Intl.DateTimeFormatOptions): string {
    const d = parseDateInput(date)
    return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "long",
        ...options,
    }).format(d)
}

export function formatDateTime(date: Date | string): string {
    const d = parseDateInput(date)
    return new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(d)
}

export function generateSlug(title: string): string {
    return title
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
        .replace(/\s+/g, "-") // Replace spaces with -
        .replace(/-+/g, "-") // Replace multiple - with single -
        .trim()
}

export function generateTicketCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // Exclude confusing chars
    let code = ""
    for (let i = 0; i < 12; i++) {
        if (i > 0 && i % 4 === 0) code += "-"
        code += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return code
}

export function getDaysBetween(start: Date, end: Date): Date[] {
    const days: Date[] = []
    const current = new Date(start)
    current.setHours(0, 0, 0, 0)
    const endDate = new Date(end)
    endDate.setHours(0, 0, 0, 0)

    while (current <= endDate) {
        days.push(new Date(current))
        current.setDate(current.getDate() + 1)
    }

    return days
}

export function isToday(date: Date | string): boolean {
    const d = typeof date === "string" ? new Date(date) : date
    const today = new Date()
    return (
        d.getDate() === today.getDate() &&
        d.getMonth() === today.getMonth() &&
        d.getFullYear() === today.getFullYear()
    )
}

export function isPastDate(date: Date | string): boolean {
    const d = typeof date === "string" ? new Date(date) : date
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    d.setHours(0, 0, 0, 0)
    return d < today
}
