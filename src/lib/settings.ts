import { Preferences } from "@capacitor/preferences";

/**
 * Device-local settings. The OpenAI key is the user's own and never leaves the
 * device except as the Authorization header on calls to OpenAI itself.
 *
 * NOTE: Capacitor Preferences maps to Android SharedPreferences, which is
 * private to the app but NOT hardware-backed encryption. Before this app is
 * distributed to anyone else, move the key to the Android Keystore.
 */

const API_KEY = "openai-api-key";
const SUMMARY_MODEL = "summary-model";
const BASE_URL = "api-base-url";
const TRANSCRIPTION_MODEL_KEY = "transcription-model";

export const DEFAULT_SUMMARY_MODEL = "gpt-5-mini";

/**
 * The default endpoint is OpenAI itself. A custom base URL lets the app talk to
 * any OpenAI-compatible gateway — e.g. a LiteLLM proxy — for both chat
 * completions and audio transcription. Store just the origin (no `/v1`, no
 * trailing slash); the endpoint paths are appended by the resolvers below.
 */
export const DEFAULT_BASE_URL = "https://api.openai.com";

/**
 * whisper-1 is not interchangeable on OpenAI: it is the only transcription
 * model that supports `response_format: verbose_json`, and this app depends on
 * the per-segment start/end timestamps that only that format returns. Against a
 * custom gateway (LiteLLM) this may instead be whatever alias routes to a
 * whisper deployment — hence it is overridable, but it must still return
 * verbose_json segments or the transcript timeline breaks.
 */
export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-1";

/** Strip whitespace, trailing slashes, and a trailing `/v1` so callers can
 *  paste either "https://host" or "https://host/v1" and get the same result. */
function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  url = url.replace(/\/v1$/i, "");
  return url || DEFAULT_BASE_URL;
}

export async function getBaseUrl(): Promise<string> {
  const { value } = await Preferences.get({ key: BASE_URL });
  return value?.trim() ? normalizeBaseUrl(value) : DEFAULT_BASE_URL;
}

export async function setBaseUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) {
    await Preferences.remove({ key: BASE_URL });
    return;
  }
  await Preferences.set({ key: BASE_URL, value: normalizeBaseUrl(trimmed) });
}

export async function isCustomEndpoint(): Promise<boolean> {
  return (await getBaseUrl()) !== DEFAULT_BASE_URL;
}

export async function chatCompletionsUrl(): Promise<string> {
  return `${await getBaseUrl()}/v1/chat/completions`;
}

export async function transcriptionsUrl(): Promise<string> {
  return `${await getBaseUrl()}/v1/audio/transcriptions`;
}

export async function getTranscriptionModel(): Promise<string> {
  const { value } = await Preferences.get({ key: TRANSCRIPTION_MODEL_KEY });
  return value?.trim() || DEFAULT_TRANSCRIPTION_MODEL;
}

export async function setTranscriptionModel(model: string): Promise<void> {
  const trimmed = model.trim();
  if (!trimmed || trimmed === DEFAULT_TRANSCRIPTION_MODEL) {
    await Preferences.remove({ key: TRANSCRIPTION_MODEL_KEY });
    return;
  }
  await Preferences.set({ key: TRANSCRIPTION_MODEL_KEY, value: trimmed });
}

export async function getApiKey(): Promise<string | null> {
  const { value } = await Preferences.get({ key: API_KEY });
  return value?.trim() ? value.trim() : null;
}

export async function setApiKey(key: string): Promise<void> {
  await Preferences.set({ key: API_KEY, value: key.trim() });
}

export async function clearApiKey(): Promise<void> {
  await Preferences.remove({ key: API_KEY });
}

export async function getSummaryModel(): Promise<string> {
  const { value } = await Preferences.get({ key: SUMMARY_MODEL });
  return value?.trim() || DEFAULT_SUMMARY_MODEL;
}

export async function setSummaryModel(model: string): Promise<void> {
  await Preferences.set({ key: SUMMARY_MODEL, value: model.trim() });
}

export async function requireApiKey(): Promise<string> {
  const key = await getApiKey();
  if (!key) {
    throw new Error(
      "No OpenAI API key is configured. Add one in settings to transcribe and summarize meetings.",
    );
  }
  return key;
}
