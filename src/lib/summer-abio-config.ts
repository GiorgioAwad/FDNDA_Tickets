import { getMembershipScheduleProfile } from "@/lib/membership-schedule"
import { SUMMER_MEMBERSHIP_SCHEDULE_KEY } from "@/lib/membership-config"

/** Canonical NATACION LMV codes, verified against the ABIO catalogue. */
const CODES_BY_START: Record<string, string> = {
    "06:00": "000001", "07:00": "000002", "08:00": "000003", "09:00": "000004",
    "10:00": "000005", "11:00": "000006", "12:00": "000007", "13:00": "000008",
    "14:00": "000009", "15:00": "000010", "16:00": "000011", "17:00": "000012",
    "18:00": "000013", "19:00": "000077", "20:00": "000148",
}

export const SUMMER_ABIO_SERVICE_CODE = "K14"
export const SUMMER_ABIO_DISCIPLINE_CODE = "00"
export const SUMMER_ABIO_POOL_CODE = "01"
export const SUMMER_ABIO_SCHEDULES = getMembershipScheduleProfile("01", SUMMER_MEMBERSHIP_SCHEDULE_KEY)!
    .categories.flatMap(category => category.frequencies[0].dayGroups[0].hours.map(hour => ({
        category: category.id, categoryLabel: category.label, frequency: "LMV",
        start: hour.start, end: hour.end, capacity: hour.capacity!, scheduleCode: CODES_BY_START[hour.start],
    })))

export const SUMMER_ABIO_EXTRA_CONFIG = {
    membershipSchedules: {
        profileKey: SUMMER_MEMBERSHIP_SCHEDULE_KEY,
        serviceStartDate: "2027-01-01",
        codes: Object.fromEntries(SUMMER_ABIO_SCHEDULES.map(row => [
            `${row.category}:${row.frequency}:${row.start}-${row.end}`, row.scheduleCode,
        ])),
    },
}
