import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiKey, setApiKey } from "@/lib/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

const API_KEY_STATUS = ["apiKeyStatus"] as const;

export function useApiKeyStatus() {
  return useQuery({
    queryKey: API_KEY_STATUS,
    queryFn: async () => ({ configured: Boolean(await getApiKey()) }),
  });
}

export function useSaveApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => setApiKey(key),
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
  const save = useSaveApiKey();
  const trimmed = value.trim();
  // OpenAI keys are "sk-…"; catching an obviously wrong paste here is friendlier
  // than a 401 surfacing later, mid-meeting.
  const looksValid = trimmed.startsWith("sk-") && trimmed.length > 20;

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
            Your meetings are stored only on this device. Add your own OpenAI key
            to transcribe and summarize them — it is saved locally and sent
            nowhere but OpenAI.
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (!looksValid) return;
            save.mutate(trimmed, { onSuccess: () => onSaved?.() });
          }}
        >
          <Input
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder="sk-..."
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 rounded-xl bg-card"
            aria-label="OpenAI API key"
          />
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
