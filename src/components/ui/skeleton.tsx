export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse motion-reduce:animate-none rounded-md bg-muted skeleton ${className}`}
      aria-hidden="true"
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border/30">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-4 py-3.5 sm:px-5 sm:py-4"
        >
          <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 pr-3">
            <Skeleton className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg shrink-0" />
            <div className="min-w-0 space-y-1.5 flex-1">
              <Skeleton className="h-4 sm:h-4.5 w-32 sm:w-48" />
              <Skeleton className="h-3 w-44 sm:w-60" />
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <Skeleton className="h-4 sm:h-5 w-16 sm:w-20" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-1/4" />
      <div className="flex items-end gap-2 h-64">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-md bg-muted"
            style={{ height: `${Math.random() * 80 + 20}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-3">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}
