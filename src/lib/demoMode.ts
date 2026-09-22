import { Preferences } from "@capacitor/preferences";
import type { MeetingSummary } from "@shared/meeting";
import type { WhisperResponse } from "./transcription";

/**
 * Play Store / QA review path that does not need an OpenAI key.
 *
 * When enabled, transcription and meeting summarization return canned content
 * on-device. No network calls are made for those features. Real keys still win:
 * if the user saves an API key, live OpenAI is used even while the demo flag is
 * set (so reviewers can paste a key later without hunting for an exit toggle).
 */

const DEMO_MODE_KEY = "demo-mode";

export async function isDemoModeEnabled(): Promise<boolean> {
  const { value } = await Preferences.get({ key: DEMO_MODE_KEY });
  return value === "1";
}

export async function setDemoModeEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await Preferences.set({ key: DEMO_MODE_KEY, value: "1" });
  } else {
    await Preferences.remove({ key: DEMO_MODE_KEY });
  }
}

/** True when we should serve canned AI results (demo on AND no real key). */
export async function shouldUseDemoAi(
  hasApiKey: boolean | null,
): Promise<boolean> {
  if (hasApiKey) return false;
  return isDemoModeEnabled();
}

const DEMO_LINES = [
  "Thanks everyone for joining. Let's review the product launch checklist.",
  "Design signed off on the store screenshots yesterday.",
  "Engineering will cut a release candidate by Friday.",
  "Action item: Alex will send the privacy policy draft to legal.",
  "We decided to keep the free tier without a hard recording limit for launch.",
  "Any other blockers before we wrap?",
  "None from my side. Thanks all.",
];

/**
 * Build a plausible whisper-style response sized to the recorded chunk length
 * so the transcript timeline still looks real during review.
 */
export function buildDemoWhisperResponse(durationSecHint?: number): WhisperResponse {
  const duration =
    typeof durationSecHint === "number" && durationSecHint > 0
      ? durationSecHint
      : DEMO_LINES.length * 4;
  const step = duration / DEMO_LINES.length;
  const segments = DEMO_LINES.map((text, index) => {
    const start = index * step;
    const end = Math.min(duration, (index + 1) * step);
    return {
      id: index,
      seek: 0,
      start,
      end,
      text: ` ${text}`,
      tokens: [] as number[],
      temperature: 0,
      avg_logprob: 0,
      compression_ratio: 1,
      no_speech_prob: 0,
    };
  });
  return {
    task: "transcribe",
    language: "en",
    duration,
    text: DEMO_LINES.join(" "),
    segments,
  };
}

export function buildDemoMeetingSummary(): MeetingSummary {
  return {
    suggestedTitle: "Product launch checklist (demo)",
    overview:
      "Demo summary for store review: the team reviewed launch readiness, confirmed design assets, and scheduled an RC cut. No live AI was used.",
    keyTopics: [
      {
        topic: "Store assets",
        details: "Design signed off on Play Store screenshots.",
      },
      {
        topic: "Release plan",
        details: "Engineering will cut a release candidate by Friday.",
      },
      {
        topic: "Free tier",
        details:
          "Agreed to keep the free tier without a hard recording limit for launch.",
      },
    ],
    decisions: [
      {
        decision: "Ship free tier without a hard recording limit at launch",
        context: "Confirmed in the demo meeting wrap-up.",
      },
    ],
    actionItems: [
      {
        task: "Send the privacy policy draft to legal",
        owner: "Alex",
        dueDate: "Not specified",
        topic: "Compliance",
      },
      {
        task: "Cut release candidate build",
        owner: "Engineering",
        dueDate: "Friday",
        topic: "Release plan",
      },
    ],
  };
}
