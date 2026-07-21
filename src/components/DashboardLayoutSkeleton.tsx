import { Skeleton } from "@/components/ui/skeleton";

export function DashboardLayoutSkeleton() {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[280px] shrink-0 border-r border-sidebar-border/60 p-4 md:block">
        <Skeleton className="h-11 w-full rounded-xl" />
        <div className="mt-8 flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      </div>
      <div className="flex-1 p-8">
        <Skeleton className="h-10 w-64 rounded-lg" />
        <Skeleton className="mt-8 h-80 w-full rounded-[2rem]" />
      </div>
    </div>
  );
}
