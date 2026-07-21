import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getLocalDayFromKey } from "@/lib/dates";
import { useDailySummary } from "@/lib/queries";
import { ArrowLeft, ClipboardCheck, Sparkles } from "lucide-react";
import { Link, useParams } from "wouter";

export default function DailySummaryDetail() {
  const params = useParams<{ localDate: string }>();
  const localDate = params.localDate ?? "";
  const { data: day, isLoading } = useDailySummary(localDate);

  if (isLoading) {
    return (
      <div className="p-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-8 h-80 rounded-[2rem]" />
      </div>
    );
  }

  if (!day) {
    return (
      <div className="p-10">
        <p className="text-sm text-muted-foreground">
          No daily summary exists for that date.
        </p>
        <Link href="/days" className="mt-4 inline-block text-primary">
          All daily summaries
        </Link>
      </div>
    );
  }

  const { dayStartAtMs } = getLocalDayFromKey(day.localDate);

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={new Date(dayStartAtMs).toLocaleDateString(undefined, {
          weekday: "long",
        })}
        title={new Date(dayStartAtMs).toLocaleDateString(undefined, {
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        description={day.overview}
      />

      <div className="p-5 sm:p-8 lg:p-10">
        <Link
          href="/days"
          className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All daily summaries
        </Link>

        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="rounded-[1.75rem] border-0 p-7 shadow-sm ring-1 ring-border/60">
            <div className="flex items-center gap-3">
              <div className="brand-mark h-10 w-10">
                <Sparkles className="h-4 w-4" />
              </div>
              <h2 className="font-display text-2xl">Highlights</h2>
            </div>
            {day.highlights.length ? (
              <ul className="mt-5 flex flex-col gap-3">
                {day.highlights.map((highlight, index) => (
                  <li
                    key={index}
                    className="flex gap-3 text-sm leading-6 text-muted-foreground"
                  >
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    {highlight}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">
                No highlights were recorded for this day.
              </p>
            )}
          </Card>

          <Card className="rounded-[1.75rem] border-0 p-7 shadow-sm ring-1 ring-border/60">
            <div className="flex items-center gap-3">
              <div className="brand-mark h-10 w-10">
                <ClipboardCheck className="h-4 w-4" />
              </div>
              <h2 className="font-display text-2xl">Action items</h2>
            </div>
            {day.actionItems.length ? (
              <ul className="mt-5 flex flex-col gap-4">
                {day.actionItems.map((item, index) => (
                  <li key={index} className="border-b border-border/60 pb-4 last:border-0">
                    <p className="text-sm font-semibold leading-6">{item.task}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.owner} · due {item.dueDate}
                    </p>
                    <Link
                      href={`/meetings/${item.meetingId}`}
                      className="mt-2 inline-block text-xs font-semibold text-primary"
                    >
                      Open source meeting
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">
                No commitments were captured for this day.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
