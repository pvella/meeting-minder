import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, shortDate, timeOfDay } from "@/lib/dates";
import { exportMeetingPdf } from "@/lib/pdfExport";
import { useMeetings } from "@/lib/queries";
import { ArrowUpRight, Clock3, FileText, Loader2, Search, Share2, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

const statusLabel = { recording: "Recording", processing: "Summarizing", completed: "Ready", failed: "Needs attention" } as const;

export default function MeetingHistory() {
  const { data: meetings = [], isLoading } = useMeetings();
  const [query, setQuery] = useState("");
  const [exportingId, setExportingId] = useState<number | null>(null);
  const filtered = useMemo(() => meetings.filter(meeting => `${meeting.title} ${meeting.summaryOverview ?? ""}`.toLowerCase().includes(query.toLowerCase())), [meetings, query]);

  async function handleExport(meeting: (typeof meetings)[number]) {
    setExportingId(meeting.id);
    try {
      await exportMeetingPdf(meeting);
    } catch (error) {
      toast.error("Could not export the PDF", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setExportingId(null);
    }
  }

  return <div className="min-h-screen"><PageHeader eyebrow="Meeting memory" title="Every meeting, distilled." description="Browse the durable record: concise summaries, decisions, and action items. Rename any meeting later to match how you remember it." action={<div className="relative w-full lg:w-72"><Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search summaries" className="h-11 rounded-xl bg-card pl-10" /></div>} />
    <div className="p-5 sm:p-8 lg:p-10">
      {isLoading ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-64 rounded-[1.5rem]" />)}</div> : filtered.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(meeting => {
        const ready = meeting.status === "completed";
        const content = <Card className="summary-card group h-full rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60"><div className="flex items-center justify-between gap-3"><Badge variant="secondary" className="rounded-full"><span className={`mr-2 h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-600" : meeting.status === "failed" ? "bg-destructive" : "animate-pulse bg-amber-500"}`} />{statusLabel[meeting.status]}</Badge>{ready ? <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" /> : null}</div><h2 className="mt-6 font-display text-2xl leading-tight group-hover:text-primary">{meeting.title}</h2><p className="mt-3 line-clamp-3 text-sm leading-6 text-muted-foreground">{meeting.summaryOverview || (meeting.status === "failed" ? meeting.failureReason || "Summary generation can be retried." : "Summary is being prepared from the conversation.")}</p><div className="mt-7 flex items-center gap-4 border-t border-border/60 pt-4 text-xs font-semibold text-muted-foreground"><span className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{timeOfDay(meeting.startedAtMs)}</span><span>{shortDate(meeting.startedAtMs)}</span><span>{formatDuration(meeting.durationMs)}</span></div></Card>;
        if (meeting.status === "recording") return <div key={meeting.id}>{content}</div>;
        return <div key={meeting.id} className="relative"><Link href={`/meetings/${meeting.id}`}>{content}</Link>{ready ? <Button variant="secondary" size="sm" className="absolute bottom-5 right-5 h-8 gap-1.5 rounded-full px-3 text-xs shadow-sm" disabled={exportingId === meeting.id} onClick={event => { event.preventDefault(); event.stopPropagation(); handleExport(meeting); }}>{exportingId === meeting.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}PDF</Button> : null}</div>;
      })}</div> : <div className="empty-panel flex min-h-[420px] flex-col items-center justify-center rounded-[2rem] p-8 text-center"><div className="brand-mark h-14 w-14"><FileText className="h-6 w-6" /></div><h2 className="mt-6 font-display text-3xl">{query ? "No matching summaries." : "Your first summary starts with a conversation."}</h2><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{query ? "Try a different name or phrase." : "Open Record, capture a meeting, and UnRecorded will build the concise record here."}</p>{!query ? <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground"><Sparkles className="h-4 w-4" />Start recording</Link> : null}</div>}
    </div>
  </div>;
}
