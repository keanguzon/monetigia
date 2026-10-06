import { Skeleton } from "./skeleton";

export const summaryPanelClass = "rounded-2xl border border-border/40 bg-card/40 p-5 sm:p-7 shadow-sm";
export const summaryAmountClass = "text-2xl sm:text-3xl font-extrabold font-heading tabular-nums tracking-tight";
export const pageTitleClass = "text-2xl sm:text-3xl font-bold tracking-tight text-foreground";

export function SummarySkeleton({ columns = 3 }: { columns?: 3 | 4 }) {
  return (
    <div role="status" aria-label="Loading summary" className={summaryPanelClass}>
      <div
        className={`grid grid-cols-1 gap-6 sm:gap-8 ${
          columns === 4
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : "sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border/30"
        }`}
      >
        {Array.from({ length: columns }, (_, index) => (
          <div
            key={index}
            className={`space-y-3 ${
              columns === 4
                ? "border-t border-border/30 pt-5 first:border-0 first:pt-0 sm:border-t-0 sm:pt-0 sm:even:border-l sm:even:pl-8 lg:[&:not(:first-child)]:border-l lg:[&:not(:first-child)]:pl-8"
                : index > 0
                ? "sm:pl-8 pt-4 sm:pt-0"
                : ""
            }`}
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-40 max-w-full" />
            <Skeleton className="h-4 w-32 max-w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
