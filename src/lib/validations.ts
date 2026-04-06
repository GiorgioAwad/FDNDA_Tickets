import { z } from "zod"

// ==================== USER SCHEMAS ====================

export const registerSchema = z.object({
    name: z
        .string()
        .min(2, "El nombre debe tener al menos 2 caracteres")
        .max(100, "El nombre es muy largo"),
    email: z
        .string()
        .email("Ingresa un email valido")
        .transform((v) => v.toLowerCase()),
    password: z
        .string()
        .min(8, "La contrasena debe tener al menos 8 caracteres")
        .regex(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
            "La contrasena debe incluir mayusculas, minusculas y numeros"
        ),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Las contrasenas no coinciden",
    path: ["confirmPassword"],
})

export const loginSchema = z.object({
    email: z.string().email("Ingresa un email valido"),
    password: z.string().min(1, "Ingresa tu contrasena"),
})

export const forgotPasswordSchema = z.object({
    email: z.string().email("Ingresa un email valido"),
})

export const resetPasswordSchema = z.object({
    token: z.string(),
    password: z.string().min(8, "La contrasena debe tener al menos 8 caracteres"),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Las contrasenas no coinciden",
    path: ["confirmPassword"],
})

// ==================== EVENT SCHEMAS ====================

export const eventSchema = z.object({
    title: z.string().min(5, "El titulo debe tener al menos 5 caracteres"),
    description: z.string().min(20, "La descripcion debe tener al menos 20 caracteres"),
    location: z.string().min(3, "Ingresa la ubicacion"),
    venue: z.string().min(3, "Ingresa el nombre del lugar"),
    discipline: z.string().optional(),
    startDate: z.string().or(z.date()),
    endDate: z.string().or(z.date()),
    mode: z.enum(["RANGE", "DAYS"]),
    isPublished: z.boolean().default(false),
    bannerUrl: z.string().url().optional().or(z.literal("")),
})

export const eventDaySchema = z.object({
    date: z.string().or(z.date()),
    openTime: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:MM"),
    closeTime: z.string().regex(/^\d{2}:\d{2}$/, "Formato HH:MM"),
    capacity: z.number().int().min(0).default(0),
})

export const ticketTypeSchema = z.object({
    name: z.string().min(2, "El nombre es requerido"),
    description: z.string().optional(),
    price: z.number().min(0, "El precio no puede ser negativo"),
    capacity: z.number().int().min(0).default(0),
    isPackage: z.boolean().default(false),
    packageDaysCount: z.number().int().min(1).optional(),
    validDays: z.unknown().optional(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
    servilexEnabled: z.boolean().default(false),
    servilexIndicator: z.string().optional(),
    servilexSucursalCode: z.string().optional(),
    servilexServiceCode: z.string().optional(),
    servilexDisciplineCode: z.string().optional(),
    servilexScheduleCode: z.string().optional(),
    servilexPoolCode: z.string().optional(),
    servilexExtraConfig: z.unknown().optional(),
})

// ==================== BILLING SCHEMAS ====================

const commonBillingFields = {
    buyerAddress: z.string().min(5, "Direccion requerida"),
    buyerEmail: z.string().email("Email requerido"),
    buyerPhone: z.string().regex(/^\d{7,15}$/, "Celular debe tener entre 7 y 15 digitos"),
    buyerUbigeo: z.string().regex(/^\d{5,6}$/, "Ubigeo debe tener 5 o 6 digitos"),
}

export const boletaBillingSchema = z.object({
    documentType: z.literal("BOLETA"),
    buyerDocNumber: z.string().regex(/^\d{8}$/, "DNI debe tener 8 digitos"),
    buyerName: z.string().min(2, "Nombre requerido"),
    buyerFirstName: z.string().min(2, "Primer nombre requerido"),
    buyerSecondName: z.string().optional(),
    buyerLastNamePaternal: z.string().min(2, "Apellido paterno requerido"),
    buyerLastNameMaternal: z.string().min(2, "Apellido materno requerido"),
    ...commonBillingFields,
})

export const facturaBillingSchema = z.object({
    documentType: z.literal("FACTURA"),
    buyerDocNumber: z.string().regex(/^\d{11}$/, "RUC debe tener 11 digitos"),
    buyerName: z.string().min(2, "Razon social requerida"),
    buyerFirstName: z.string().optional(),
    buyerSecondName: z.string().optional(),
    buyerLastNamePaternal: z.string().optional(),
    buyerLastNameMaternal: z.string().optional(),
    ...commonBillingFields,
})

export const billingDataSchema = z.discriminatedUnion("documentType", [
    boletaBillingSchema,
    facturaBillingSchema,
])

// ==================== ORDER SCHEMAS ====================

export const orderItemSchema = z.object({
    ticketTypeId: z.string(),
    quantity: z.number().int().min(1, "Cantidad minima: 1"),
    attendees: z.array(
        z.object({
            name: z.string().min(2, "Nombre requerido"),
            dni: z.string().min(8, "DNI requerido").max(12),
            matricula: z.string().max(50).optional(),
            scheduleSelections: z
                .array(
                    z.object({
                        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha invalida"),
                        shift: z.string().optional(),
                    })
                )
                .optional(),
        })
    ).optional(),
})

export const createOrderSchema = z.object({
    eventId: z.string(),
    items: z.array(orderItemSchema).min(1, "Agrega al menos una entrada"),
    billing: billingDataSchema,
})

// ==================== SCAN SCHEMAS ====================

export const validateScanSchema = z.object({
    ticketId: z.string(),
    eventId: z.string(),
    userId: z.string(),
    date: z.string(),
    ticketCode: z.string(),
    nonce: z.string(),
    signature: z.string(),
})

// ==================== COURTESY SCHEMAS ====================

export const courtesyBatchSchema = z.object({
    eventId: z.string(),
    ticketTypeId: z.string(),
    quantity: z.number().int().min(1).max(100),
    reason: z.string().optional(),
})

// ==================== TYPE EXPORTS ====================

export type RegisterInput = z.infer<typeof registerSchema>
export type LoginInput = z.infer<typeof loginSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type EventInput = z.infer<typeof eventSchema>
export type EventDayInput = z.infer<typeof eventDaySchema>
export type TicketTypeInput = z.infer<typeof ticketTypeSchema>
export type OrderItemInput = z.infer<typeof orderItemSchema>
export type CreateOrderInput = z.infer<typeof createOrderSchema>
export type ValidateScanInput = z.infer<typeof validateScanSchema>
export type CourtesyBatchInput = z.infer<typeof courtesyBatchSchema>
export type BillingDataInput = z.infer<typeof billingDataSchema>
