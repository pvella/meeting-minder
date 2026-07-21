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

export const DEFAULT_SUMMARY_MODEL = "gpt-5-mini";

/**
 * whisper-1 is not interchangeable here. It is the only transcription model
 * that supports `response_format: verbose_json`, and this app depends on the
 * per-segment start/end timestamps that only that format returns. The newer
 * gpt-4o-transcribe models return plain text and would break the transcript
 * timeline entirely.
 */
export const TRANSCRIPTION_MODEL = "whisper-1";

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
