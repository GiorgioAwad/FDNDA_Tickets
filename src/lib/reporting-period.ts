export type ReportPeriod = "7d" | "30d" | "all"

const limaDateFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
})

export function getLimaDateParts(date: Date) {
    const parts = limaDateFormatter.formatToParts(date)
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
    return { year: value("year"), month: value("month"), day: value("day") }
}

export function getLimaDateKey(date: Date): string {
    const { year, month, day } = getLimaDateParts(date)
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

// Peru uses UTC-5 throughout the year. The end of a range is exclusive.
export function limaDayStartUtc(year: number, month: number, day: number): Date {
    return new Date(Date.UTC(year, month - 1, day, 5))
}

export function getReportPeriodStart(period: ReportPeriod, now: Date): Date | null {
    if (period === "all") return null
    const { year, month, day } = getLimaDateParts(now)
    return limaDayStartUtc(year, month, day - (period === "7d" ? 6 : 29))
}

export function getCurrentLimaMonth(now: Date) {
    const { year, month, day } = getLimaDateParts(now)
    return {
        start: limaDayStartUtc(year, month, 1),
        end: limaDayStartUtc(year, month + 1, 1),
        elapsedDays: day,
        daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    }
}

export function projectMonthlyRevenue(monthToDateRevenue: number, now: Date): number {
    const { elapsedDays, daysInMonth } = getCurrentLimaMonth(now)
    return (monthToDateRevenue / elapsedDays) * daysInMonth
}
