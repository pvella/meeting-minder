import { PageHeader } from "@/components/PageHeader";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";

export default function Settings() {
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery({
    queryKey: ["settingsForm"],
    queryFn: async () => {
      const [key, baseUrl, summaryModel, transcriptionModel] =
        await Promise.all([
          getApiKey(),
          getBaseUrl(),
          getSummaryModel(),
          getTranscriptionModel(),
        ]);
      return { hasKey: Boolean(key), baseUrl, summaryModel, transcriptionModel };
    },
  });

  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrlValue] = useState("");
  const [summaryModel, setSummaryModelValue] = useState("");
  const [transcriptionModel, setTranscriptionModelValue] = useState("");
  const [saving, setSaving] = useState(false);

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
      if (newKey) await setApiKey(newKey);
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
    toast.success("API key removed.");
    setLocation("/");
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
