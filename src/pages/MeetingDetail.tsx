import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, getLocalDay, longDate, timeOfDay } from "@/lib/dates";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Lightbulb,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";

export default function MeetingDetail() {
  const params = useParams<{ id: string }>();
  const meetingId = Number(params.id);
  const utils = trpc.useUtils();
  const { data: meeting, isLoading } = trpc.meeting.detail.useQuery(
    { meetingId },
    {
      enabled: Number.isInteger(meetingId) && meetingId > 0,
      refetchInterval: query =>
        query.state.data?.status === "processing" ? 5_000 : false,
    },
  );
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (meeting) setTitle(meeting.title);
  }, [meeting]);

  const rename = trpc.meeting.rename.useMutation({
    onSuccess: async () => {
      setEditing(false);
      await Promise.all([
        utils.meeting.detail.invalidate({ meetingId }),
        utils.meeting.list.invalidate(),
        utils.dailySummary.list.invalidate(),
        utils.dailySummary.detail.invalidate(),
      ]);
    },
  });
  const retrySummary = trpc.meeting.summarize.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.meeting.detail.invalidate({ meetingId }),
        utils.meeting.list.invalidate(),
        utils.dailySummary.list.invalidate(),
        utils.dailySummary.detail.invalidate(),
      ]);
    },
  });

  if (isLoading) {
    return (
      <div className="p-10">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-8 h-80 rounded-[2rem]" />
      </div>
    );
  }
  if (!meeting) {
    return (
      <div className="p-10">
        <p>Meeting summary not found.</p>
        <Link href="/meetings" className="mt-4 inline-block text-primary">
          Back to summaries
        </Link>
      </div>
    );
  }

  const day = getLocalDay(meeting.startedAtMs);
  const isReady = meeting.status === "completed";
  const isFailed = meeting.status === "failed";
  const hasFailedAudio = !meeting.retrySummaryAvailable && Boolean(
    meeting.failureReason?.toLowerCase().includes("audio section"),
  );

  if (!isReady) {
    return (
      <div className="min-h-screen">
        <PageHeader
          eyebrow="Individual meeting"
          title={meeting.title}
          description={`${longDate(meeting.startedAtMs)} at ${timeOfDay(meeting.startedAtMs)} · ${formatDuration(meeting.durationMs)}`}
        />
        <div className="p-5 sm:p-8 lg:p-10">
          <Link
            href="/meetings"
            className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All meetings
          </Link>
          <Card className="empty-panel flex min-h-[420px] flex-col items-center justify-center rounded-[2rem] p-8 text-center">
            <div className="brand-mark h-14 w-14">
              {isFailed ? (
                <AlertCircle className="h-6 w-6" />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin" />
              )}
            </div>
            <h1 className="mt-6 font-display text-3xl">
              {isFailed ? "This summary needs another try." : "The summary is being prepared."}
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
              {isFailed
                ? meeting.failureReason || "The summary service could not complete this meeting. Your meeting record is still private and available to retry."
                : "Echo Ledger is converting the temporary processing transcript into topics, decisions, and action items."}
            </p>
            {isFailed && !hasFailedAudio ? (
              <Button
                className="mt-6 rounded-full"
                onClick={() => retrySummary.mutate({ meetingId, ...day })}
                disabled={retrySummary.isPending}
              >
                {retrySummary.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Retry summary
              </Button>
            ) : null}
            {isFailed && hasFailedAudio ? (
              <Button asChild className="mt-6 rounded-full">
                <Link href="/">Start a new meeting</Link>
              </Button>
            ) : null}
            {retrySummary.error ? (
              <p className="mt-4 text-sm font-medium text-destructive">
                {retrySummary.error.message}
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Individual meeting"
        title={editing ? "Rename this meeting." : meeting.title}
        description={`${longDate(meeting.startedAtMs)} at ${timeOfDay(meeting.startedAtMs)} · ${formatDuration(meeting.durationMs)}`}
        action={
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setTitle(meeting.title);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => rename.mutate({ meetingId, title, ...day })}
                  disabled={!title.trim() || rename.isPending}
                >
                  <Save className="mr-2 h-4 w-4" />
                  {rename.isPending ? "Saving…" : "Save name"}
                </Button>
              </>
            ) : (
              <Button variant="outline" className="bg-card" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" /> Rename
              </Button>
            )}
          </div>
        }
      />
      <div className="p-5 sm:p-8 lg:p-10">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link
            href="/meetings"
            className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All meetings
          </Link>
          <span className="text-border">/</span>
          <Link
            href={`/days/${day.localDate}`}
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary"
          >
            <CalendarDays className="h-4 w-4" /> View this day
          </Link>
        </div>

        {editing ? (
          <Card className="mb-6 rounded-[1.5rem] border-0 p-5 ring-1 ring-border/60">
            <label className="eyebrow" htmlFor="meeting-title">
              Meeting name
            </label>
            <Input
              id="meeting-title"
              value={title}
              onChange={event => setTitle(event.target.value)}
              maxLength={200}
              className="mt-3 h-12 rounded-xl text-base"
              autoFocus
            />
          </Card>
        ) : null}

        {rename.error ? (
          <Alert variant="destructive" className="mb-6 rounded-2xl">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>The name could not be saved</AlertTitle>
            <AlertDescription>{rename.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,.7fr)]">
          <div className="space-y-5">
            <Card className="summary-hero rounded-[2rem] border-0 p-7 text-white shadow-xl sm:p-9">
              <Badge className="rounded-full bg-white/10 text-white hover:bg-white/10">
                <Sparkles className="mr-2 h-3.5 w-3.5" /> AI summary
              </Badge>
              <p className="mt-6 font-display text-3xl leading-[1.25] sm:text-4xl">
                {meeting.summaryOverview}
              </p>
            </Card>
            <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
              <div className="flex items-center gap-3">
                <div className="icon-tile"><Lightbulb className="h-4 w-4" /></div>
                <h2 className="text-lg font-bold">Key topics</h2>
              </div>
              <div className="mt-5 space-y-5">
                {meeting.keyTopics?.length ? meeting.keyTopics.map((item, index) => (
                  <div key={index} className="border-l-2 border-primary/25 pl-4">
                    <h3 className="font-semibold">{item.topic}</h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.details}</p>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No distinct topics were captured.</p>}
              </div>
            </Card>
          </div>

          <div className="space-y-5">
            <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
              <div className="flex items-center gap-3">
                <div className="icon-tile"><Target className="h-4 w-4" /></div>
                <h2 className="text-lg font-bold">Decisions</h2>
              </div>
              <div className="mt-5 space-y-4">
                {meeting.decisions?.length ? meeting.decisions.map((item, index) => (
                  <div key={index} className="flex gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">{item.decision}</p>
                      {item.context ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.context}</p> : null}
                    </div>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No explicit decisions were detected.</p>}
              </div>
            </Card>
            <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
              <div className="flex items-center gap-3">
                <div className="icon-tile"><ClipboardCheck className="h-4 w-4" /></div>
                <h2 className="text-lg font-bold">Action items</h2>
              </div>
              <div className="mt-5 space-y-3">
                {meeting.actionItems?.length ? meeting.actionItems.map((item, index) => (
                  <div key={index} className="rounded-xl bg-muted/60 p-4">
                    <p className="text-sm font-semibold">{item.task}</p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-muted-foreground">
                      <span>{item.owner}</span><span>·</span><span>{item.dueDate}</span>
                    </div>
                  </div>
                )) : <p className="text-sm text-muted-foreground">No explicit action items were detected.</p>}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
