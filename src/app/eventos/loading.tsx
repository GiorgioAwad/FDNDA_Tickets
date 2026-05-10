import { SkeletonCard, Skeleton } from "@/components/ui/skeleton"

export default function Loading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-fdnda-light/40 via-white to-white">
      <section className="bg-gradient-to-br from-fdnda-primary via-fdnda-secondary to-fdnda-primary text-white py-12 sm:py-16">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto space-y-4">
            <Skeleton rounded="full" className="h-6 w-44 mx-auto bg-white/20" />
            <Skeleton rounded="lg" className="h-12 sm:h-16 w-3/4 mx-auto bg-white/20" />
            <Skeleton rounded="md" className="h-5 w-2/3 mx-auto bg-white/15" />
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 py-8 sm:py-10">
        <Skeleton rounded="2xl" className="h-20 mb-6 sm:mb-8" />
        <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    </div>
  )
}
