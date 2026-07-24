import { chatCompletionsUrl, getSummaryModel, requireApiKey } from "./settings";

/**
 * Minimal OpenAI chat-completions client.
 *
 * Trimmed down from the Manus `llm.ts`, which carried tool-calling, image and
 * file content parts, and a dual snake_case/camelCase parameter surface. The
 * only callers here send text messages and ask for a strict json_schema
 * response, so the rest is gone. The retry/backoff behaviour is kept verbatim —
 * that part earns its place on a mobile connection.
 */

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletion = {
  choices: Array<{ message: { content: string | null } }>;
};

const RETRY_MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 30_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
};

// Equal-jitter exponential backoff. The cap/2 floor guarantees a minimum delay
// so a misbehaving caller loop slows down instead of hammering the upstream
// while it keeps returning errors.
const computeBackoffDelay = (attempt: number, retryAfterMs?: number): number => {
  const cap = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  const jittered = cap / 2 + Math.random() * (cap / 2);
  return Math.min(Math.max(jittered, retryAfterMs ?? 0), RETRY_MAX_DELAY_MS);
};

/**
 * Retries 5xx and 429 with backoff. 4xx other than 429 are returned as-is: a
 * bad key or a malformed schema will fail identically on every attempt, and
 * retrying only delays the error the user needs to see.
 */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);
      const isRetryable = response.status === 429 || response.status >= 500;
      if (response.ok || !isRetryable || attempt === RETRY_MAX_RETRIES) {
        return response;
      }

      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      try {
        await response.body?.cancel();
      } catch {
        // Body already settled; nothing to clean up.
      }
      console.warn(
        `[openai] retry ${attempt + 1}/${RETRY_MAX_RETRIES} after status ${response.status}`,
      );
      await sleep(computeBackoffDelay(attempt, retryAfterMs));
    } catch (error) {
      lastError = error;
      if (attempt === RETRY_MAX_RETRIES) throw error;
      console.warn(
        `[openai] retry ${attempt + 1}/${RETRY_MAX_RETRIES} after network error`,
      );
      await sleep(computeBackoffDelay(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenAI request failed after exhausting retries");
}

export async function invokeLLM(params: {
  messages: ChatMessage[];
  jsonSchema?: JsonSchema;
  maxTokens?: number;
  model?: string;
}): Promise<ChatCompletion> {
  const apiKey = await requireApiKey();
  const model = params.model ?? (await getSummaryModel());

  const payload: Record<string, unknown> = {
    model,
    messages: params.messages,
  };

  if (params.maxTokens) payload.max_tokens = params.maxTokens;
  if (params.jsonSchema) {
    payload.response_format = {
      type: "json_schema",
      json_schema: params.jsonSchema,
    };
  }

  const response = await fetchWithBackoff(await chatCompletionsUrl(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => response.statusText);
    throw new Error(`OpenAI request failed (${response.status}): ${details}`);
  }

  return (await response.json()) as ChatCompletion;
}
