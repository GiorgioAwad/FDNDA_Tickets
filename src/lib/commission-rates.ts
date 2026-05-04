export const IZIPAY_COMMISSION_RATE = 0.021
export const IGV_RATE = 0.18
export const TOTAL_COMMISSION_RATE = IZIPAY_COMMISSION_RATE * (1 + IGV_RATE)

// Fee fijo por transaccion (Izipay virtual)
export const IZIPAY_PUNTO_WEB_FEE_PEN = 0.69
export const IZIPAY_CYBERSOURCE_FEE_USD = 0.20
export const USD_TO_PEN_FOR_FEES = 3.75
export const IZIPAY_FIXED_FEE_PER_TX_PEN =
    IZIPAY_PUNTO_WEB_FEE_PEN + IZIPAY_CYBERSOURCE_FEE_USD * USD_TO_PEN_FOR_FEES

export function calculateIzipayCommission(revenue: number, orderCount: number): {
    percentageAmount: number
    fixedAmount: number
    total: number
} {
    const percentageAmount = revenue * TOTAL_COMMISSION_RATE
    const fixedAmount = orderCount * IZIPAY_FIXED_FEE_PER_TX_PEN
    return {
        percentageAmount,
        fixedAmount,
        total: percentageAmount + fixedAmount,
    }
}
