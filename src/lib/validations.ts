import { z } from "zod"

// ==================== USER SCHEMAS ====================

export const registerSchema = z.object({
    name: z
        .string()
        .min(2, "El nombre debe tener al menos 2 caracteres")
        .max(100, "El nombre es muy largo"),
    email: z
        .string()
        .email("Ingresa un email v\u00e1lido")
        .transform((v) => v.toLowerCase()),
    password: z
        .string()
        .min(8, "La contrase\u00f1a debe tener al menos 8 caracteres")
        .regex(
            /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
            "La contrase\u00f1a debe incluir may\u00fasculas, min\u00fasculas y n\u00fameros"
        ),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Las contrase\u00f1as no coinciden",
    path: ["confirmPassword"],
})

export const loginSchema = z.object({
    email: z.string().email("Ingresa un email v\u00e1lido"),
    password: z.string().min(1, "Ingresa tu contrase\u00f1a"),
})

export const forgotPasswordSchema = z.object({
    email: z.string().email("Ingresa un email v\u00e1lido"),
})

export const resetPasswordSchema = z.object({
    token: z.string(),
    password: z.string().min(8, "La contrase\u00f1a debe tener al menos 8 caracteres"),
    confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
    message: "Las contrase\u00f1as no coinciden",
    path: ["confirmPassword"],
})

// ==================== EVENT SCHEMAS ====================

export const eventSchema = z.object({
    title: z.string().min(5, "El t\u00edtulo debe tener al menos 5 caracteres"),
    description: z.string().min(20, "La descripci\u00f3n debe tener al menos 20 caracteres"),
    location: z.string().min(3, "Ingresa la ubicaci\u00f3n"),
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
    validDays: z.array(z.string()).optional(),
    isActive: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
})

// ==================== ORDER SCHEMAS ====================

export const orderItemSchema = z.object({
    ticketTypeId: z.string(),
    quantity: z.number().int().min(1, "Cantidad m\u00ednima: 1"),
    attendees: z.array(
        z.object({
            name: z.string().min(2, "Nombre requerido"),
            dni: z.string().min(8, "DNI requerido").max(12),
        })
    ).optional(),
})

export const createOrderSchema = z.object({
    eventId: z.string(),
    items: z.array(orderItemSchema).min(1, "Agrega al menos una entrada"),
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
