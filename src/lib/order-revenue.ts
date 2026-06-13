export function roundCurrency(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100
}

export function allocateAmountsProportionally(
    baseAmounts: number[],
    finalTotal: number
): number[] {
    if (baseAmounts.length === 0) return []

    const finalTotalCents = Math.max(0, Math.round(finalTotal * 100))
    const baseCents = baseAmounts.map((amount) => Math.max(0, Math.round(amount * 100)))
    const totalBaseCents = baseCents.reduce((sum, amount) => sum + amount, 0)

    if (totalBaseCents === 0) {
        return baseCents.map(() => 0)
    }

    const allocations = baseCents.map((amount, index) => {
        const exactCents = (amount / totalBaseCents) * finalTotalCents
        const cents = Math.floor(exactCents)

        return {
            index,
            cents,
            remainder: exactCents - cents,
        }
    })

    let remainingCents =
        finalTotalCents - allocations.reduce((sum, allocation) => sum + allocation.cents, 0)

    allocations
        .slice()
        .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
        .forEach((allocation) => {
            if (remainingCents <= 0) return
            allocations[allocation.index].cents += 1
            remainingCents -= 1
        })

    return allocations.map((allocation) => allocation.cents / 100)
}
