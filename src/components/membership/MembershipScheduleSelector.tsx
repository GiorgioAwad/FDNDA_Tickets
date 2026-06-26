"use client"

import {
    slotToValue,
    formatSlotLabel,
    type MembershipScheduleProfile,
    type MembershipScheduleInput,
} from "@/lib/membership-schedule"

interface Props {
    profile: MembershipScheduleProfile
    value: MembershipScheduleInput
    onChange: (next: MembershipScheduleInput) => void
    disabled?: boolean
}

/**
 * Selector de horario de membresía (categoría + frecuencia + hora por grupo)
 * controlado por `value`/`onChange`. Reutilizable: emite un MembershipScheduleInput
 * completo en cada cambio. La validación final la hace el servidor con
 * validateMembershipScheduleSelection.
 */
export function MembershipScheduleSelector({ profile, value, onChange, disabled }: Props) {
    const hours = value.hours ?? {}
    const selectedCategory = profile.categories.find((c) => c.id === value.category) ?? null
    const chooseFrequency = profile.planMode === "CHOOSE_FREQUENCY"
    const selectedFreqId = selectedCategory
        ? chooseFrequency
            ? (selectedCategory.frequencies.find((f) => f.id === value.frequency)?.id ?? "")
            : selectedCategory.frequencies[0].id
        : ""
    const selectedFreq = selectedCategory?.frequencies.find((f) => f.id === selectedFreqId) ?? null

    const emit = (next: MembershipScheduleInput) => {
        if (disabled) return
        onChange(next)
    }

    return (
        <div className="rounded-md border border-dashed border-sky-200 bg-sky-50 px-3 py-3 space-y-3">
            <div>
                <label className="text-[11px] font-medium text-sky-800 mb-1 block">¿Para quién es?</label>
                <div className="flex flex-wrap gap-2">
                    {profile.categories.map((cat) => {
                        const active = cat.id === selectedCategory?.id
                        return (
                            <button
                                key={cat.id}
                                type="button"
                                disabled={disabled}
                                onClick={() =>
                                    emit({
                                        category: cat.id,
                                        frequency: chooseFrequency ? null : cat.frequencies[0].id,
                                        hours: {},
                                    })
                                }
                                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                                    active
                                        ? "border-sky-500 bg-white text-sky-800 ring-1 ring-sky-400"
                                        : "border-sky-200 bg-white/60 text-sky-600 hover:border-sky-300"
                                }`}
                            >
                                {cat.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            {selectedCategory && chooseFrequency && (
                <div>
                    <label className="text-[11px] font-medium text-sky-800 mb-1 block">Frecuencia</label>
                    <div className="flex flex-wrap gap-2">
                        {selectedCategory.frequencies.map((freq) => {
                            const active = freq.id === selectedFreqId
                            return (
                                <button
                                    key={freq.id}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() =>
                                        emit({ category: selectedCategory.id, frequency: freq.id, hours: {} })
                                    }
                                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                                        active
                                            ? "border-sky-500 bg-white text-sky-800 ring-1 ring-sky-400"
                                            : "border-sky-200 bg-white/60 text-sky-600 hover:border-sky-300"
                                    }`}
                                >
                                    {freq.label}
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {selectedCategory && selectedFreq && (
                <div className="space-y-2">
                    {selectedFreq.dayGroups.map((group) => {
                        const v = hours[group.id] ?? ""
                        const valid = group.hours.some((h) => slotToValue(h) === v)
                        return (
                            <div key={group.id}>
                                <label className="text-[11px] text-sky-700 mb-1 block">Horario · {group.label}</label>
                                <select
                                    value={valid ? v : ""}
                                    disabled={disabled}
                                    onChange={(e) =>
                                        emit({
                                            category: selectedCategory.id,
                                            frequency: selectedFreqId,
                                            hours: { ...hours, [group.id]: e.target.value },
                                        })
                                    }
                                    className="w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm disabled:opacity-50"
                                >
                                    <option value="">Selecciona un horario</option>
                                    {group.hours.map((h) => {
                                        const hv = slotToValue(h)
                                        return (
                                            <option key={hv} value={hv}>
                                                {formatSlotLabel(h)}
                                            </option>
                                        )
                                    })}
                                </select>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
