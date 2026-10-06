import { Skeleton } from "@/components/ui/skeleton";

export function GoalCardSkeleton() {
  return (
    <div
      className="flex flex-col justify-between rounded-xl border border-border/40 bg-card/50 p-4 sm:p-5"
      aria-hidden="true"
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-7 w-14" />
        </div>
        <div className="my-3.5 space-y-2">
          <div className="flex justify-between items-baseline">
            <Skeleton className="h-6 w-36" />
            <Skeleton className="h-4 w-10" />
          </div>
          <Skeleton className="h-1.5 w-full" />
        </div>
      </div>
      <Skeleton className="mt-2 h-9 w-full rounded-md" />
      <div className="mt-2 pt-3 border-t border-border/30 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-7 w-20 rounded-lg" />
      </div>
    </div>
  );
}
