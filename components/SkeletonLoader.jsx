export default function SkeletonLoader() {
  return (
    <div
      className="space-y-6"
      aria-busy="true"
      aria-label="Loading comparison results"
    >
      {/* Hero comparison card */}
      <div className="relative overflow-hidden rounded-[22px] border border-[#E4DFCF]/80 bg-white/85 p-5 shadow-[0_24px_70px_-56px_rgba(26,24,21,0.45)] backdrop-blur-sm sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#8B8780]/35 to-transparent"
        />
        <div className="grid grid-cols-1 gap-7 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4">
            <div className="shimmer-surface aspect-[4/5] w-full rounded-[18px] border border-[#EEEAE1]/70" />
          </div>

          <div className="flex flex-col justify-between gap-6 lg:col-span-8">
            <div className="space-y-3.5">
              <div className="flex items-center gap-3">
                <div className="shimmer-surface h-2.5 w-16 rounded-full" />
                <div className="shimmer-surface h-2.5 w-24 rounded-full" />
              </div>
              <div className="shimmer-surface h-9 w-5/6 rounded-md" />
              <div className="shimmer-surface h-9 w-3/5 rounded-md" />
              <div className="shimmer-surface h-4 w-full max-w-xl rounded-full" />
              <div className="shimmer-surface h-4 w-2/3 max-w-lg rounded-full" />
            </div>

            <div className="rounded-[18px] border border-[#EEEAE1]/70 bg-[#F0EDE4]/60 p-5">
              <div className="flex justify-between">
                <div className="shimmer-surface h-3 w-36 rounded-full" />
                <div className="shimmer-surface h-3 w-24 rounded-full" />
              </div>
              <div className="shimmer-surface mt-4 h-24 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>

      {/* Best deal banner placeholder */}
      <div className="shimmer-surface h-16 w-full rounded-[20px] border border-[#E4DFCF]/70" />

      {/* Retailer rows placeholder */}
      <div className="divide-y divide-[#EEEAE1]/60 overflow-hidden rounded-[20px] border border-[#E4DFCF]/80 bg-white/85 backdrop-blur-sm">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="flex flex-col justify-between gap-4 px-5 py-5 sm:flex-row sm:items-center"
          >
            <div className="space-y-2">
              <div className="shimmer-surface h-4 w-32 rounded-full" />
              <div className="shimmer-surface h-3 w-24 rounded-full" />
            </div>
            <div className="shimmer-surface h-5 w-20 rounded-full" />
            <div className="shimmer-surface h-5 w-24 rounded-full" />
            <div className="shimmer-surface h-9 w-28 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
