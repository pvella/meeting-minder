import { PageHeader } from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { shortDate } from "@/lib/dates";
import { useMeetings, useSetActionItemCompletion } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Check, ClipboardCheck, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";

const UNCATEGORISED = "Uncategorised";

type Filter = "open" | "done" | "all";

type FlatActionItem = {
  key: string;
  meetingId: number;
  index: number;
  meetingTitle: string;
  startedAtMs: number;
  task: string;
  owner: string;
  dueDate: string;
  topic: string;
  completedAtMs: number | null;
};

const filterTabs: { id: Filter; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "done", label: "Completed" },
  { id: "all", label: "All" },
];

export default function ActionItems() {
  const { data: meetings = [], isLoading } = useMeetings();
  const setCompletion = useSetActionItemCompletion();
  const [filter, setFilter] = useState<Filter>("open");

  // Flatten every completed meeting's action items into one addressable list.
  // Items have no id of their own, so (meetingId, index) is their identity.
  const items = useMemo<FlatActionItem[]>(() => {
    return meetings
      .filter(meeting => meeting.status === "completed")
      .flatMap(meeting =>
        (meeting.actionItems ?? []).map((item, index) => ({
          key: `${meeting.id}:${index}`,
          meetingId: meeting.id,
          index,
          meetingTitle: meeting.title,
          startedAtMs: meeting.startedAtMs,
          task: item.task,
          owner: item.owner,
          dueDate: item.dueDate,
          topic: item.topic?.trim() || UNCATEGORISED,
          completedAtMs: item.completedAtMs ?? null,
        })),
      );
  }, [meetings]);

  const openCount = items.filter(item => !item.completedAtMs).length;
  const doneCount = items.length - openCount;

  const visible = items.filter(item =>
    filter === "open"
      ? !item.completedAtMs
      : filter === "done"
        ? item.completedAtMs
        : true,
  );

  // Group by topic. Uncategorised always sorts last; every other topic
  // alphabetically. Within a group, open items first, then by meeting time.
  const groups = useMemo(() => {
    const byTopic = new Map<string, FlatActionItem[]>();
    for (const item of visible) {
      const list = byTopic.get(item.topic) ?? [];
      list.push(item);
      byTopic.set(item.topic, list);
    }
    return Array.from(byTopic.entries())
      .sort(([a], [b]) => {
        if (a === UNCATEGORISED) return 1;
        if (b === UNCATEGORISED) return -1;
        return a.localeCompare(b);
      })
      .map(([topic, list]) => ({
        topic,
        items: list.sort(
          (left, right) =>
            Number(Boolean(left.completedAtMs)) -
              Number(Boolean(right.completedAtMs)) ||
            left.startedAtMs - right.startedAtMs,
        ),
      }));
  }, [visible]);

  const toggle = (item: FlatActionItem) =>
    setCompletion.mutate({
      meetingId: item.meetingId,
      index: item.index,
      completedAtMs: item.completedAtMs ? null : Date.now(),
    });

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Action items"
        title="Everything you agreed to do."
        description="Commitments gathered from every meeting summary and grouped by topic. Tick them off as you go; completed items stay searchable."
      />
      <div className="p-5 sm:p-8 lg:p-10">
        <div className="mb-6 inline-flex rounded-full bg-muted/60 p-1 ring-1 ring-border/60">
          {filterTabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
                filter === tab.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.id === "open" ? ` · ${openCount}` : null}
              {tab.id === "done" ? ` · ${doneCount}` : null}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-40 rounded-[1.5rem]" />
            ))}
          </div>
        ) : groups.length ? (
          <div className="space-y-6">
            {groups.map(group => (
              <section key={group.topic}>
                <div className="mb-3 flex items-center gap-3">
                  <div className="icon-tile">
                    <ClipboardCheck className="h-4 w-4" />
                  </div>
                  <h2 className="text-lg font-bold">{group.topic}</h2>
                  <span className="text-sm font-semibold text-muted-foreground">
                    {group.items.length}
                  </span>
                </div>
                <Card className="divide-y divide-border/60 rounded-[1.5rem] border-0 p-2 shadow-sm ring-1 ring-border/60">
                  {group.items.map(item => {
                    const done = Boolean(item.completedAtMs);
                    return (
                      <div key={item.key} className="flex items-start gap-3 p-4">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={done}
                          aria-label={done ? "Mark as open" : "Mark as complete"}
                          onClick={() => toggle(item)}
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                            done
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-muted-foreground/40 hover:border-primary",
                          )}
                        >
                          {done ? <Check className="h-3.5 w-3.5" /> : null}
                        </button>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "text-sm font-semibold leading-6",
                              done && "text-muted-foreground line-through",
                            )}
                          >
                            {item.task}
                          </p>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-semibold">{item.owner}</span>
                            <span>·</span>
                            <span>due {item.dueDate}</span>
                            <span>·</span>
                            <Link
                              href={`/meetings/${item.meetingId}`}
                              className="font-semibold text-primary hover:underline"
                            >
                              {item.meetingTitle}
                            </Link>
                            <span className="text-muted-foreground/70">
                              {shortDate(item.startedAtMs)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </Card>
              </section>
            ))}
          </div>
        ) : (
          <div className="empty-panel flex min-h-[360px] flex-col items-center justify-center rounded-[2rem] p-8 text-center">
            <div className="brand-mark h-14 w-14">
              <ListChecks className="h-6 w-6" />
            </div>
            <h2 className="mt-6 font-display text-3xl">
              {filter === "open"
                ? "No open action items."
                : filter === "done"
                  ? "Nothing completed yet."
                  : "No action items captured yet."}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
              {filter === "open"
                ? "Every commitment has been ticked off. Record a meeting and new tasks will collect here."
                : "Tick items complete and they will appear here."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
