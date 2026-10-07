import { Skeleton } from "@/components/ui/skeleton";

export function GoalCardSkeleton() {
  return (
    <div className="flex flex-col justify-between rounded-xl border border-border/40 bg-card/50 p-4 sm:p-5" aria-hidden="true">
      <div>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-4 w-24" /></div>
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
        <div className="my-3.5 space-y-2"><div className="flex justify-between"><Skeleton className="h-6 w-36" /><Skeleton className="h-4 w-10" /></div><Skeleton className="h-1.5 w-full" /></div>
        <div className="grid grid-cols-2 gap-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-24" /></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/30 pt-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-8 w-20 rounded-md" /></div>
    </div>
  );
}
