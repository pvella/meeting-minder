import { PageHeader } from "@/components/PageHeader";
import {
  isDemoModeEnabled,
  setDemoModeEnabled,
} from "@/lib/demoMode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_BASE_URL,
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  clearApiKey,
  getApiKey,
  getBaseUrl,
  getSummaryModel,
  getTranscriptionModel,
  setApiKey,
  setBaseUrl,
  setSummaryModel,
  setTranscriptionModel,
} from "@/lib/settings";
import { exportBackup, parseBackup, restoreBackup } from "@/lib/backup";
import { queryKeys } from "@/lib/queries";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Download,
  KeyRound,
  RotateCcw,
  Save,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Settings() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery({
    queryKey: ["settingsForm"],
    queryFn: async () => {
      const [key, baseUrl, summaryModel, transcriptionModel, demoMode] =
        await Promise.all([
          getApiKey(),
          getBaseUrl(),
          getSummaryModel(),
          getTranscriptionModel(),
          isDemoModeEnabled(),
        ]);
      return {
        hasKey: Boolean(key),
        demoMode: demoMode && !key,
        baseUrl,
        summaryModel,
        transcriptionModel,
      };
    },
  });

  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrlValue] = useState("");
  const [summaryModel, setSummaryModelValue] = useState("");
  const [transcriptionModel, setTranscriptionModelValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prefill once loaded (the key itself is never read back into the field —
  // leave it blank to keep the existing key, type to replace it).
  useEffect(() => {
    if (!data) return;
    setBaseUrlValue(data.baseUrl === DEFAULT_BASE_URL ? "" : data.baseUrl);
    setSummaryModelValue(data.summaryModel);
    setTranscriptionModelValue(data.transcriptionModel);
  }, [data]);

  const usingCustomEndpoint = baseUrl.trim().length > 0;
  const endpointLabel = usingCustomEndpoint ? baseUrl.trim() : "OpenAI (default)";

  async function handleSave() {
    const newKey = key.trim();
    // Guard an obviously wrong OpenAI paste; custom-gateway keys vary in format.
    if (newKey && !usingCustomEndpoint && !newKey.startsWith("sk-")) {
      toast.error("An OpenAI key should start with \"sk-\".");
      return;
    }
    setSaving(true);
    try {
      await setBaseUrl(baseUrl.trim());
      await setSummaryModel(summaryModel.trim() || DEFAULT_SUMMARY_MODEL);
      await setTranscriptionModel(transcriptionModel.trim());
      if (newKey) {
        await setApiKey(newKey);
        await setDemoModeEnabled(false);
      }
      setKey("");
      await queryClient.invalidateQueries({ queryKey: ["settingsForm"] });
      await queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] });
      toast.success("Settings saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleClearKey() {
    await clearApiKey();
    await queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] });
    await queryClient.invalidateQueries({ queryKey: ["settingsForm"] });
    toast.success("API key removed.");
    setLocation("/");
  }

  async function handleExitDemo() {
    await setDemoModeEnabled(false);
    await queryClient.invalidateQueries({ queryKey: ["apiKeyStatus"] });
    await queryClient.invalidateQueries({ queryKey: ["settingsForm"] });
    toast.success("Demo mode turned off. Add an API key to use live AI.");
    setLocation("/");
  }

  async function handleExport() {
    setExporting(true);
    try {
      const result = await exportBackup();
      toast.success(
        `Exported ${result.meetings} meeting${result.meetings === 1 ? "" : "s"} and ${result.dailySummaries} daily summar${result.dailySummaries === 1 ? "y" : "ies"}.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Export failed.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const backup = parseBackup(text);
      const result = await restoreBackup(backup);
      await queryClient.invalidateQueries({ queryKey: queryKeys.meetings });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.dailySummaries,
      });
      const added = result.meetingsAdded + result.dailySummariesAdded;
      const skipped = result.meetingsSkipped + result.dailySummariesSkipped;
      if (added === 0) {
        toast.info(
          skipped > 0
            ? "Nothing new to import — everything in that file is already here."
            : "That backup was empty.",
        );
      } else {
        toast.success(
          `Imported ${result.meetingsAdded} meeting${result.meetingsAdded === 1 ? "" : "s"}` +
            (result.dailySummariesAdded > 0
              ? ` and ${result.dailySummariesAdded} daily summar${result.dailySummariesAdded === 1 ? "y" : "ies"}`
              : "") +
            (skipped > 0 ? ` (${skipped} already present, skipped).` : "."),
        );
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Import failed.",
      );
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Connect to OpenAI or any OpenAI-compatible endpoint (e.g. a LiteLLM proxy). Everything is stored on this device only."
      />

      <div className="mx-auto max-w-2xl px-5 py-8 sm:px-8">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-8">
            {data?.demoMode ? (
              <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
                <h2 className="font-display text-lg">Demo mode</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Play Store review path: transcripts and summaries are sample
                  content generated on this device. No OpenAI calls are made.
                  Add an API key below to switch to live AI.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 rounded-xl"
                  onClick={() => void handleExitDemo()}
                >
                  Exit demo mode
                </Button>
              </section>
            ) : null}
            {/* Connection */}
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="font-display text-lg">Connection</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Currently connected to:{" "}
                  <span className="font-medium text-foreground">
                    {endpointLabel}
                  </span>
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  API key
                </label>
                <Input
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  placeholder={
                    data?.hasKey
                      ? "•••••••••• (leave blank to keep)"
                      : usingCustomEndpoint
                        ? "API key"
                        : "sk-..."
                  }
                  type="password"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-11 rounded-xl bg-card"
                  aria-label="API key"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  API base URL
                </label>
                <Input
                  value={baseUrl}
                  onChange={e => setBaseUrlValue(e.target.value)}
                  placeholder={DEFAULT_BASE_URL}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-11 rounded-xl bg-card font-mono text-xs"
                  aria-label="API base URL"
                />
                <p className="text-[11px] leading-4 text-muted-foreground">
                  Leave blank for OpenAI. For a LiteLLM proxy, use its origin
                  (e.g. https://litellm.powertech…) — <code>/v1</code> is added
                  automatically.
                </p>
              </div>
            </section>

            {/* Models */}
            <section className="flex flex-col gap-4">
              <div>
                <h2 className="font-display text-lg">Models</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Use the model names your endpoint exposes (LiteLLM aliases
                  differ from OpenAI's).
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Summary model
                  </label>
                  <Input
                    value={summaryModel}
                    onChange={e => setSummaryModelValue(e.target.value)}
                    placeholder={DEFAULT_SUMMARY_MODEL}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-11 rounded-xl bg-card font-mono text-xs"
                    aria-label="Summary model"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Transcription model
                  </label>
                  <Input
                    value={transcriptionModel}
                    onChange={e => setTranscriptionModelValue(e.target.value)}
                    placeholder={DEFAULT_TRANSCRIPTION_MODEL}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-11 rounded-xl bg-card font-mono text-xs"
                    aria-label="Transcription model"
                  />
                </div>
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Transcription must return <code>verbose_json</code> segments
                (whisper-1 on OpenAI, or an equivalent whisper route on your
                gateway), or the transcript timeline will break.
              </p>
            </section>

            {/* Data — backup / restore */}
            <section className="flex flex-col gap-4 border-t border-border/60 pt-6">
              <div>
                <h2 className="font-display text-lg">Your data</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Meetings live only on this device. Export a backup file you
                  can keep safe or move to another phone — and import it to
                  restore. Import is additive and never overwrites what's
                  already here.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={handleExport}
                  disabled={exporting}
                  size="lg"
                  variant="outline"
                  className="h-11 rounded-xl"
                >
                  <Download className="mr-2 h-4 w-4" />
                  {exporting ? "Exporting…" : "Export backup"}
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importing}
                  size="lg"
                  variant="outline"
                  className="h-11 rounded-xl"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {importing ? "Importing…" : "Import backup"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0];
                    e.target.value = ""; // allow re-selecting the same file
                    if (file) void handleImportFile(file);
                  }}
                />
              </div>
            </section>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-6">
              <Button
                onClick={handleSave}
                disabled={saving}
                size="lg"
                className="h-11 rounded-xl"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving…" : "Save settings"}
              </Button>
              <Button
                onClick={() => {
                  setBaseUrlValue("");
                  setSummaryModelValue(DEFAULT_SUMMARY_MODEL);
                  setTranscriptionModelValue(DEFAULT_TRANSCRIPTION_MODEL);
                }}
                variant="outline"
                size="lg"
                className="h-11 rounded-xl"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset to OpenAI defaults
              </Button>
              {data?.hasKey ? (
                <Button
                  onClick={handleClearKey}
                  variant="ghost"
                  size="lg"
                  className="h-11 rounded-xl text-destructive hover:text-destructive"
                >
                  <KeyRound className="mr-2 h-4 w-4" />
                  Remove key
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
