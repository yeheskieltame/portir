export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy>
      <div className="mt-4 h-3 w-40 rounded bg-white/10" />
      <div className="mt-4 h-9 w-72 rounded bg-white/10" />
      <div className="mt-2 h-9 w-52 rounded bg-white/10" />
      <div className="glass mt-6 divide-y divide-line rounded-3xl">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <div className="size-10 rounded-full bg-white/10" />
            <div className="flex-1">
              <div className="h-3.5 w-28 rounded bg-white/10" />
              <div className="mt-2 h-2.5 w-20 rounded bg-white/10" />
            </div>
            <div className="h-3.5 w-16 rounded bg-white/10" />
          </div>
        ))}
      </div>
    </div>
  );
}
