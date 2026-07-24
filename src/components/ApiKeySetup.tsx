import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_BASE_URL,
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  getApiKey,
  getBaseUrl,
  getSummaryModel,
  getTranscriptionModel,
  setApiKey,
  setBaseUrl,
  setSummaryModel,
  setTranscriptionModel,
} from "@/lib/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, KeyRound, Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const API_KEY_STATUS = ["apiKeyStatus"] as const;

export function useApiKeyStatus() {
  return useQuery({
    queryKey: API_KEY_STATUS,
    queryFn: async () => ({ configured: Boolean(await getApiKey()) }),
  });
}

type SaveInput = {
  key: string;
  baseUrl: string;
  summaryModel: string;
  transcriptionModel: string;
};

export function useSaveApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      key,
      baseUrl,
      summaryModel,
      transcriptionModel,
    }: SaveInput) => {
      await setBaseUrl(baseUrl);
      await setSummaryModel(summaryModel || DEFAULT_SUMMARY_MODEL);
      await setTranscriptionModel(transcriptionModel);
      // Key last: it is what gates the app, so it becomes "configured" only
      // once the endpoint settings are already persisted.
      await setApiKey(key);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: API_KEY_STATUS }),
  });
}

/**
 * Replaces the Manus sign-in gate. There are no accounts on this build — the
 * only thing the app needs before it can do anything useful is an OpenAI key,
 * so that is what the entry screen collects.
 */
export function ApiKeySetup({ onSaved }: { onSaved?: () => void }) {
  const [value, setValue] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [baseUrl, setBaseUrlValue] = useState("");
  const [summaryModel, setSummaryModelValue] = useState("");
  const [transcriptionModel, setTranscriptionModelValue] = useState("");
  const save = useSaveApiKey();

  // Prefill the advanced fields from any previously saved values (this screen
  // doubles as the "change key / endpoint" editor after a reset).
  useEffect(() => {
    void (async () => {
      const [b, s, t] = await Promise.all([
        getBaseUrl(),
        getSummaryModel(),
        getTranscriptionModel(),
      ]);
      if (b !== DEFAULT_BASE_URL) {
        setBaseUrlValue(b);
        setAdvancedOpen(true);
      }
      setSummaryModelValue(s);
      setTranscriptionModelValue(t);
    })();
  }, []);

  const trimmed = value.trim();
  const usingCustomEndpoint = baseUrl.trim().length > 0;
  // OpenAI keys are "sk-…" — catch an obviously wrong paste before it surfaces
  // as a 401 mid-meeting. A custom gateway (LiteLLM) may issue keys in any
  // format, so only length is required there.
  const looksValid = usingCustomEndpoint
    ? trimmed.length > 0
    : trimmed.startsWith("sk-") && trimmed.length > 20;

  return (
    <div className="login-canvas flex min-h-screen items-center justify-center px-5 py-12">
      <div className="glass-panel flex w-full max-w-md flex-col gap-8 rounded-[2rem] p-8 sm:p-10">
        <div className="flex flex-col gap-5">
          <div className="brand-mark h-12 w-12">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="eyebrow mb-3">Private meeting intelligence</p>
            <h1 className="font-display text-4xl tracking-tight text-foreground">
              Remember the work,
              <br />
              not the recording.
            </h1>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Your meetings are stored only on this device. Add an API key to
            transcribe and summarize them — it is saved locally and sent nowhere
            but {usingCustomEndpoint ? "your configured endpoint" : "OpenAI"}.
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (!looksValid) return;
            save.mutate(
              {
                key: trimmed,
                baseUrl: baseUrl.trim(),
                summaryModel: summaryModel.trim(),
                transcriptionModel: transcriptionModel.trim(),
              },
              { onSuccess: () => onSaved?.() },
            );
          }}
        >
          <Input
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder={usingCustomEndpoint ? "API key" : "sk-..."}
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 rounded-xl bg-card"
            aria-label="API key"
          />

          {/* Advanced: custom OpenAI-compatible endpoint (e.g. LiteLLM) */}
          <button
            type="button"
            onClick={() => setAdvancedOpen(o => !o)}
            className="flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            />
            Advanced — custom endpoint
          </button>
          {advancedOpen ? (
            <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/40 p-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  API base URL
                </label>
                <Input
                  value={baseUrl}
                  onChange={event => setBaseUrlValue(event.target.value)}
                  placeholder={DEFAULT_BASE_URL}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="h-10 rounded-lg bg-card font-mono text-xs"
                  aria-label="API base URL"
                />
                <p className="text-[11px] leading-4 text-muted-foreground">
                  Leave blank for OpenAI. For a LiteLLM proxy, use its origin
                  (e.g. https://litellm.powertech…) — <code>/v1</code> is added
                  automatically.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Summary model
                  </label>
                  <Input
                    value={summaryModel}
                    onChange={event => setSummaryModelValue(event.target.value)}
                    placeholder={DEFAULT_SUMMARY_MODEL}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-10 rounded-lg bg-card font-mono text-xs"
                    aria-label="Summary model"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Transcription model
                  </label>
                  <Input
                    value={transcriptionModel}
                    onChange={event =>
                      setTranscriptionModelValue(event.target.value)
                    }
                    placeholder={DEFAULT_TRANSCRIPTION_MODEL}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="h-10 rounded-lg bg-card font-mono text-xs"
                    aria-label="Transcription model"
                  />
                </div>
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Transcription must return <code>verbose_json</code> segments
                (whisper-1 on OpenAI, or an equivalent whisper route on your
                gateway), or the transcript timeline will break.
              </p>
            </div>
          ) : null}

          {save.isError ? (
            <p className="text-xs text-destructive">
              {save.error instanceof Error
                ? save.error.message
                : "The key could not be saved."}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            disabled={!looksValid || save.isPending}
            className="h-12 w-full rounded-xl shadow-lg shadow-primary/15"
          >
            <KeyRound className="mr-2 h-4 w-4" />
            {save.isPending ? "Saving…" : "Save key and continue"}
          </Button>
        </form>
      </div>
    </div>
  );
}

/** Renders children only once a key is present. */
export function ApiKeyGate({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const { data, isLoading } = useApiKeyStatus();
  if (isLoading) return <>{fallback}</>;
  if (!data?.configured) return <ApiKeySetup />;
  return <>{children}</>;
}
