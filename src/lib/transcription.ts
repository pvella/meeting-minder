import { fetchWithBackoff } from "./openai";
import {
  buildDemoWhisperResponse,
  shouldUseDemoAi,
} from "./demoMode";
import {
  getApiKey,
  getTranscriptionModel,
  requireApiKey,
  transcriptionsUrl,
} from "./settings";

/** OpenAI's stated upload ceiling for the transcription endpoint. */
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionError = {
  error: string;
  code:
    | "FILE_TOO_LARGE"
    | "INVALID_FORMAT"
    | "TRANSCRIPTION_FAILED"
    | "NO_API_KEY"
    | "SERVICE_ERROR";
  details?: string;
};

export function isTranscriptionError(
  result: WhisperResponse | TranscriptionError,
): result is TranscriptionError {
  return "error" in result;
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
};

/**
 * MediaRecorder reports its type with codec parameters attached, e.g.
 * "audio/webm;codecs=opus". The Manus version looked the full string up in this
 * map, missed, and fell back to naming the upload "meeting-chunk.audio" — which
 * OpenAI rejects, since it infers the container from the file extension.
 * Everything before the ';' is the media type proper.
 */
export function extensionForMimeType(mimeType: string): string {
  const baseType = mimeType.split(";")[0].trim().toLowerCase();
  return EXTENSION_BY_TYPE[baseType] ?? "webm";
}

export async function transcribeAudioBlob(input: {
  audio: Blob;
  mimeType: string;
  language?: string;
  prompt?: string;
}): Promise<WhisperResponse | TranscriptionError> {
  // Play review / demo: canned transcript, no network (see demoMode.ts).
  if (await shouldUseDemoAi(Boolean(await getApiKey()))) {
    const durationHint =
      input.audio.size > 0 ? Math.max(8, input.audio.size / 4000) : undefined;
    return buildDemoWhisperResponse(durationHint);
  }

  let apiKey: string;
  try {
    apiKey = await requireApiKey();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "No API key configured",
      code: "NO_API_KEY",
    };
  }

  if (input.audio.size > MAX_AUDIO_BYTES) {
    return {
      error: "Audio file exceeds the 25 MB transcription limit",
      code: "FILE_TOO_LARGE",
    };
  }

  const formData = new FormData();
  formData.append(
    "file",
    input.audio,
    `meeting-chunk.${extensionForMimeType(input.mimeType)}`,
  );
  formData.append("model", await getTranscriptionModel());
  // verbose_json is required: it is what carries the per-segment timestamps the
  // transcript timeline is built from.
  formData.append("response_format", "verbose_json");
  if (input.language) formData.append("language", input.language);
  formData.append(
    "prompt",
    input.prompt || "Transcribe this meeting audio faithfully.",
  );

  try {
    const response = await fetchWithBackoff(await transcriptionsUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const details = await response.text().catch(() => response.statusText);
      return {
        error: "Transcription request failed",
        code: "TRANSCRIPTION_FAILED",
        details,
      };
    }
    return (await response.json()) as WhisperResponse;
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
