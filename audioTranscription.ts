import type {
  TranscriptionError,
  WhisperResponse,
} from "../_core/voiceTranscription";
import { ENV } from "../_core/env";

export async function transcribeAudioBuffer(input: {
  audioBuffer: Buffer;
  mimeType: string;
  language?: string;
  prompt?: string;
}): Promise<WhisperResponse | TranscriptionError> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    return {
      error: "Voice transcription service is not configured",
      code: "SERVICE_ERROR",
    };
  }
  if (input.audioBuffer.length > 16 * 1024 * 1024) {
    return {
      error: "Audio file exceeds the 16 MB transcription limit",
      code: "FILE_TOO_LARGE",
    };
  }

  const extension = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
  }[input.mimeType] ?? "audio";
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([new Uint8Array(input.audioBuffer)], { type: input.mimeType }),
    `meeting-chunk.${extension}`,
  );
  formData.append("model", "whisper-1");
  formData.append("response_format", "verbose_json");
  if (input.language) formData.append("language", input.language);
  formData.append(
    "prompt",
    input.prompt || "Transcribe this meeting audio faithfully.",
  );

  const baseUrl = ENV.forgeApiUrl.endsWith("/")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/`;
  try {
    const response = await fetch(
      new URL("v1/audio/transcriptions", baseUrl).toString(),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ENV.forgeApiKey}`,
          "Accept-Encoding": "identity",
        },
        body: formData,
      },
    );
    if (!response.ok) {
      const details = await response.text().catch(() => response.statusText);
      return {
        error: "Transcription service request failed",
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
