import type {
    User,
    Event,
    EventDay,
    TicketType,
    Order,
    OrderItem,
    Ticket,
    TicketDayEntitlement,
    Scan,
    Invoice,
} from "@prisma/client"

export interface CourtesyBatch {
    id: string
    eventId: string
    ticketTypeId: string
    createdBy: string
    quantity: number
    reason: string | null
    createdAt: Date
}

export interface CourtesyTicket {
    id: string
    ticketId: string | null
    batchId: string
    claimCode: string
    claimedByUserId: string | null
    status: string
    expiresAt: Date | null
    claimedAt: Date | null
}

// ==================== EXTENDED TYPES ====================

export type EventWithDetails = Event & {
    eventDays: EventDay[]
    ticketTypes: TicketType[]
    creator?: Pick<User, "id" | "name">
    _count?: {
        tickets: number
    }
}

export type EventWithDetailsSerialized = Omit<
    EventWithDetails,
    "startDate" | "endDate" | "createdAt" | "updatedAt" | "ticketTypes" | "eventDays"
> & {
    startDate: string
    endDate: string
    createdAt: string
    updatedAt: string
    ticketTypes: (Omit<TicketType, "price" | "createdAt" | "updatedAt"> & {
        price: number
        createdAt: string
        updatedAt: string
    })[]
    eventDays: (Omit<EventDay, "date"> & { date: string })[]
}

export type TicketWithDetails = Ticket & {
    event: Event
    ticketType: TicketType
    entitlements: TicketDayEntitlement[]
    order: Pick<Order, "id" | "status" | "paidAt">
    courtesyInfo?: CourtesyTicket | null
}

export type OrderWithDetails = Order & {
    orderItems: (OrderItem & {
        ticketType: TicketType
    })[]
    tickets: Ticket[]
    user: Pick<User, "id" | "name" | "email">
    invoice?: Invoice | null
}

export type ScanWithDetails = Scan & {
    ticket: Ticket & {
        event: Event
        ticketType: TicketType
    }
    staff: Pick<User, "id" | "name">
}

export type CourtesyBatchWithDetails = CourtesyBatch & {
    event: Event
    ticketType: TicketType
    creator: Pick<User, "id" | "name">
    courtesyTickets: (CourtesyTicket & {
        ticket: Ticket | null
    })[]
}

// ==================== API RESPONSE TYPES ====================

export interface ApiResponse<T = unknown> {
    success: boolean
    data?: T
    error?: string
    message?: string
}

export interface PaginatedResponse<T> {
    items: T[]
    total: number
    page: number
    pageSize: number
    totalPages: number
}

// ==================== CART TYPES ====================

export interface CartItem {
    ticketTypeId: string
    ticketTypeName: string
    eventId: string
    eventTitle: string
    quantity: number
    unitPrice: number
    attendees: {
        name: string
        dni: string
    }[]
}

export interface Cart {
    items: CartItem[]
    total: number
}

// ==================== REPORT TYPES ====================

export interface SalesReport {
    eventId: string
    eventTitle: string
    totalRevenue: number
    ticketsSold: number
    ticketsUsed: number
    salesByType: {
        ticketTypeId: string
        ticketTypeName: string
        sold: number
        revenue: number
    }[]
    salesByDay: {
        date: string
        sold: number
        revenue: number
    }[]
}

export interface DashboardStats {
    totalEvents: number
    activeEvents: number
    totalTicketsSold: number
    totalRevenue: number
    ticketsUsedToday: number
    recentOrders: OrderWithDetails[]
}

// ==================== SCANNER TYPES ====================

export interface ScanValidationResult {
    valid: boolean
    reason?: "VALID" | "INVALID_SIGNATURE" | "TICKET_NOT_FOUND" | "WRONG_DAY" | "WRONG_EVENT" | "ALREADY_USED" | "EXPIRED" | "CANCELLED"
    ticket?: {
        id: string
        ticketCode: string
        attendeeName: string | null
        attendeeDni: string | null
        eventTitle: string
        ticketTypeName: string
        entryDate: string
    }
    message?: string
}

// ==================== UI TYPES ====================

export interface NavItem {
    title: string
    href: string
    icon?: React.ComponentType<{ className?: string }>
    description?: string
}

export interface FilterOption {
    label: string
    value: string
}

export interface EventFilters {
    discipline?: string
    location?: string
    dateFrom?: string
    dateTo?: string
    search?: string
}
