import { Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
    return (
        <div className="min-h-screen bg-gradient-to-b from-fdnda-light/30 via-white to-white">
            <section className="bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary py-10 sm:py-14">
                <div className="container mx-auto px-4">
                    <div className="flex items-center gap-5">
                        <Skeleton rounded="full" className="h-20 w-20 sm:h-24 sm:w-24 bg-white/20" />
                        <div className="flex-1 space-y-2">
                            <Skeleton rounded="md" className="h-3 w-24 bg-white/15" />
                            <Skeleton rounded="md" className="h-8 w-2/3 bg-white/20" />
                            <Skeleton rounded="md" className="h-4 w-1/2 bg-white/15" />
                        </div>
                    </div>
                </div>
            </section>
            <div className="container mx-auto px-4 py-8 -mt-6 relative z-10 space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} rounded="2xl" className="h-28" />
                    ))}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-3">
                        <Skeleton rounded="2xl" className="h-12" />
                        <Skeleton rounded="2xl" className="h-64" />
                    </div>
                    <div className="space-y-3">
                        <Skeleton rounded="2xl" className="h-48" />
                        <Skeleton rounded="2xl" className="h-32" />
                    </div>
                </div>
            </div>
        </div>
    )
}
