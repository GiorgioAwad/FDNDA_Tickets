import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
    return (
        <div className="space-y-6">
            <Skeleton rounded="2xl" className="h-32 sm:h-36" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} rounded="2xl" className="h-32" />
                ))}
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} rounded="xl" className="h-20" />
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Skeleton rounded="2xl" className="lg:col-span-2 h-72" />
                <Skeleton rounded="2xl" className="h-72" />
            </div>
        </div>
    )
}
