export const IZIPAY_COMMISSION_RATE = 0.021
export const IGV_RATE = 0.18
export const TOTAL_COMMISSION_RATE = IZIPAY_COMMISSION_RATE * (1 + IGV_RATE)

// Fee fijo por transaccion (Izipay virtual)
export const IZIPAY_PUNTO_WEB_FEE_PEN = 0.69
export const IZIPAY_CYBERSOURCE_FEE_USD = 0.20

// Tipo de cambio fallback si la API SUNAT no responde
export const USD_TO_PEN_FALLBACK = 3.75

export function getFixedFeePerTxPen(usdToPenRate: number = USD_TO_PEN_FALLBACK): number {
    return IZIPAY_PUNTO_WEB_FEE_PEN + IZIPAY_CYBERSOURCE_FEE_USD * usdToPenRate
}

export type IzipayCommissionBreakdown = {
    percentageAmount: number
    fixedAmount: number
    fixedFeePerTx: number
    total: number
    usdToPenRate: number
}

export function calculateIzipayCommission(
    revenue: number,
    orderCount: number,
    usdToPenRate: number = USD_TO_PEN_FALLBACK
): IzipayCommissionBreakdown {
    const fixedFeePerTx = getFixedFeePerTxPen(usdToPenRate)
    const percentageAmount = revenue * TOTAL_COMMISSION_RATE
    const fixedAmount = orderCount * fixedFeePerTx
    return {
        percentageAmount,
        fixedAmount,
        fixedFeePerTx,
        total: percentageAmount + fixedAmount,
        usdToPenRate,
    }
}
