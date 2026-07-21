import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { useMeetingRecorder } from "@/hooks/useMeetingRecorder";
import { formatTimer } from "@/lib/dates";
import { trpc } from "@/lib/trpc";
import { AlertCircle, CheckCircle2, CircleStop, LockKeyhole, Mic2, RefreshCw, Scissors, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { useState } from "react";
import { Link } from "wouter";

export default function Home() {
  const recorder = useMeetingRecorder();
  const [consentOpen, setConsentOpen] = useState(false);
  const { data: meetings = [] } = trpc.meeting.list.useQuery(undefined, {
    refetchInterval: recorder.isRecording ? 5_000 : false,
  });
  const recentCompleted = meetings.filter(meeting => meeting.status === "completed").slice(0, 3);
  const isBusy = ["requesting", "splitting", "stopping"].includes(recorder.status);

  return (
    <div className="min-h-screen bg-background">
      <PageHeader eyebrow="Live capture" title="Record the conversation." description="Speak naturally. Echo Ledger transcribes in short encrypted requests, detects meeting boundaries, and keeps the useful outcome—not a permanent recording." />

      <div className="grid gap-5 p-5 sm:p-8 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)] xl:p-10">
        <Card className={`recording-stage overflow-hidden rounded-[2rem] border-0 p-6 shadow-2xl shadow-emerald-950/15 sm:p-9 ${recorder.isRecording ? "is-live" : ""}`}>
          <div className="relative z-10 flex min-h-[520px] flex-col">
            <div className="flex items-center justify-between gap-3">
              <Badge className="rounded-full border-white/10 bg-white/10 px-3 py-1 text-white hover:bg-white/10">
                <span className={`mr-2 h-2 w-2 rounded-full ${recorder.isRecording ? "animate-pulse bg-emerald-300" : "bg-white/45"}`} />
                {recorder.isRecording ? "Recording live" : recorder.status === "requesting" ? "Requesting microphone" : "Ready to record"}
              </Badge>
              <div className="flex items-center gap-2 text-xs font-semibold text-white/60"><LockKeyhole className="h-3.5 w-3.5" /> Private workspace</div>
            </div>

            <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
              <div className={`mic-orbit mb-8 ${recorder.isRecording ? "is-active" : ""}`}>
                <div className="mic-core"><Mic2 className="h-8 w-8" /></div>
              </div>
              <p className="font-mono text-5xl font-medium tracking-[-0.05em] text-white sm:text-7xl">{formatTimer(recorder.elapsedMs)}</p>
              <p className="mt-3 text-sm text-white/55">{recorder.isRecording ? `${recorder.capturedChunkCount} captured · ${recorder.uploadingChunks} uploading · ${recorder.transcribedChunkCount} transcribed · ${recorder.pendingChunks} processing` : "Your next meeting begins when you press record"}</p>

              <div className="mt-9 flex h-20 w-full max-w-xl items-center justify-center gap-1.5" aria-label="Live audio level">
                {Array.from({ length: 34 }, (_, index) => {
                  const center = 1 - Math.abs(index - 16.5) / 16.5;
                  const height = 8 + Math.max(recorder.audioLevel * 66 * center, recorder.isRecording ? 5 + center * 8 : 0);
                  return <span key={index} className="wave-bar" style={{ height: `${height}px`, opacity: 0.28 + center * 0.65 }} />;
                })}
              </div>
            </div>

            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              {!recorder.isRecording && recorder.status !== "stopping" ? (
                <Button size="lg" className="h-14 rounded-full bg-white px-8 text-emerald-950 shadow-xl hover:bg-white/90" onClick={() => setConsentOpen(true)} disabled={isBusy}>
                  <Mic2 className="mr-2 h-5 w-5" /> {recorder.status === "requesting" ? "Opening microphone…" : "Start recording"}
                </Button>
              ) : (
                <>
                  <Button size="lg" variant="outline" className="h-13 rounded-full border-white/20 bg-white/10 px-6 text-white hover:bg-white/15 hover:text-white" onClick={() => void recorder.splitMeeting()} disabled={recorder.status !== "recording"}>
                    <Scissors className="mr-2 h-4 w-4" /> New meeting
                  </Button>
                  <Button size="lg" className="h-14 rounded-full bg-white px-7 text-emerald-950 hover:bg-white/90" onClick={() => void recorder.stopRecording()} disabled={recorder.status === "stopping"}>
                    <CircleStop className="mr-2 h-5 w-5" /> {recorder.status === "stopping" ? "Finishing…" : "Stop & summarize"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </Card>

        <div className="grid gap-5">
          {recorder.error ? (
            <Alert variant="destructive" className="rounded-2xl">
              <AlertCircle className="h-4 w-4" /><AlertTitle>{recorder.uploadError ? "Upload needs attention" : recorder.transcriptionError ? "Transcription needs attention" : "Capture needs attention"}</AlertTitle>
              <AlertDescription className="mt-1">{recorder.uploadError ?? recorder.transcriptionError ?? recorder.error}</AlertDescription>
              <div className="mt-4 flex gap-2">
                {recorder.failedChunkCount > 0 ? <Button size="sm" variant="outline" onClick={() => void recorder.retryFailedChunks()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Retry {recorder.failedChunkCount}</Button> : null}
                <Button size="sm" variant="ghost" onClick={recorder.clearError}>Dismiss</Button>
              </div>
            </Alert>
          ) : null}

          {recorder.isRecording ? (
            <p className="rounded-xl bg-muted/55 px-4 py-3 text-xs leading-5 text-muted-foreground">
              Capture check: {recorder.capturedChunkCount > 0 ? "audio is reaching the recorder" : "waiting for the first audio chunk"}. {recorder.uploadingChunks > 0 ? `${recorder.uploadingChunks} section${recorder.uploadingChunks === 1 ? " is" : "s are"} being sent securely for transcription.` : "All captured sections have finished sending."}
            </p>
          ) : null}

          <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
            <div className="flex items-start justify-between gap-4">
              <div><p className="eyebrow">Automatic split</p><h2 className="mt-2 text-lg font-semibold">Silence boundary</h2></div>
              <Waves className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">After speech has started, sustained silence closes the current meeting and begins a fresh one.</p>
            <div className="mt-6 flex items-center gap-4">
              <Slider value={[recorder.silenceThresholdSeconds]} min={8} max={30} step={1} onValueChange={value => recorder.setSilenceThresholdSeconds(value[0] ?? 12)} />
              <span className="w-12 text-right text-sm font-bold tabular-nums">{recorder.silenceThresholdSeconds}s</span>
            </div>
            {recorder.lastSplitReason ? <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> Last split: {recorder.lastSplitReason === "silence" ? "silence detected" : "manual"}</p> : null}
          </Card>

          <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
            <div className="flex items-center justify-between"><div><p className="eyebrow">Temporary transcript</p><h2 className="mt-2 text-lg font-semibold">Live processing</h2></div><ShieldCheck className="h-5 w-5 text-primary" /></div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">Visible only while processing. Transcript fragments are removed after the meeting summary is created.</p>
            <ScrollArea className="mt-4 h-40 rounded-xl bg-muted/55 p-4">
              {recorder.liveTranscript.length ? (
                <div className="space-y-3">{recorder.liveTranscript.slice(-8).map(segment => <p key={segment.id} className="text-sm leading-6"><span className="mr-2 font-mono text-[11px] text-muted-foreground">{formatTimer(segment.startMs)}</span>{segment.text}</p>)}</div>
              ) : <div className="flex h-32 items-center justify-center text-center text-sm text-muted-foreground">{recorder.isRecording ? "Listening for speech…" : "Live words will appear here while recording."}</div>}
            </ScrollArea>
          </Card>

          {recentCompleted.length ? <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60"><div className="flex items-center justify-between"><div><p className="eyebrow">Recent memory</p><h2 className="mt-2 text-lg font-semibold">Latest summaries</h2></div><Link href="/meetings" className="text-xs font-bold text-primary hover:underline">View all</Link></div><div className="mt-4 divide-y divide-border/70">{recentCompleted.map(meeting => <Link key={meeting.id} href={`/meetings/${meeting.id}`} className="group flex items-center justify-between gap-4 py-3"><span className="line-clamp-1 text-sm font-semibold group-hover:text-primary">{meeting.title}</span><Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></Link>)}</div></Card> : null}
        </div>
      </div>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent className="rounded-[1.5rem] sm:max-w-md">
          <DialogHeader><div className="brand-mark mb-3 h-11 w-11"><ShieldCheck className="h-5 w-5" /></div><DialogTitle className="font-display text-3xl">Record responsibly.</DialogTitle><DialogDescription className="pt-2 leading-6">Only record people who know about the recording and have agreed where required. Audio is sent in short chunks for transcription and is not kept as a permanent recording.</DialogDescription></DialogHeader>
          <DialogFooter className="mt-3 gap-2 sm:gap-0"><Button variant="ghost" onClick={() => setConsentOpen(false)}>Cancel</Button><Button onClick={() => { setConsentOpen(false); void recorder.startRecording(); }}>I have permission — start</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
