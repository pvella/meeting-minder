import { z } from "zod";
import type { TranscriptSegment } from "../../drizzle/schema";
import type { MeetingSummary } from "../../shared/meeting";
import { invokeLLM } from "../_core/llm";

export const meetingSummarySchema = z.object({
  suggestedTitle: z.string().min(1).max(200),
  overview: z.string().min(1),
  keyTopics: z.array(
    z.object({
      topic: z.string().min(1),
      details: z.string().min(1),
    }),
  ),
  decisions: z.array(
    z.object({
      decision: z.string().min(1),
      context: z.string(),
    }),
  ),
  actionItems: z.array(
    z.object({
      task: z.string().min(1),
      owner: z.string(),
      dueDate: z.string(),
    }),
  ),
});

const responseSchema = {
  type: "object",
  properties: {
    suggestedTitle: {
      type: "string",
      description: "A concise, specific meeting title under 80 characters.",
    },
    overview: {
      type: "string",
      description: "A compact executive summary grounded only in the transcript.",
    },
    keyTopics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          details: { type: "string" },
        },
        required: ["topic", "details"],
        additionalProperties: false,
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          decision: { type: "string" },
          context: { type: "string" },
        },
        required: ["decision", "context"],
        additionalProperties: false,
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string" },
          owner: {
            type: "string",
            description: "Named owner, or 'Unassigned' if none was stated.",
          },
          dueDate: {
            type: "string",
            description: "Stated due date, or 'Not specified'.",
          },
        },
        required: ["task", "owner", "dueDate"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "suggestedTitle",
    "overview",
    "keyTopics",
    "decisions",
    "actionItems",
  ],
  additionalProperties: false,
} as const;

function formatTimestamp(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map(value => value.toString().padStart(2, "0"))
    .join(":");
}

export function transcriptToPrompt(segments: TranscriptSegment[]) {
  return segments
    .map(segment => `[${formatTimestamp(segment.startMs)}] ${segment.text.trim()}`)
    .filter(line => line.length > 11)
    .join("\n");
}

export function parseMeetingSummary(content: string): MeetingSummary {
  const parsed = meetingSummarySchema.parse(JSON.parse(content));
  return parsed;
}

export async function generateMeetingSummary(
  segments: TranscriptSegment[],
): Promise<MeetingSummary> {
  const transcript = transcriptToPrompt(segments);
  if (!transcript.trim()) {
    return {
      suggestedTitle: "Meeting with no detected speech",
      overview:
        "No intelligible speech was detected in this recording, so no topics, decisions, or action items could be extracted.",
      keyTopics: [],
      decisions: [],
      actionItems: [],
    };
  }

  const response = await invokeLLM({
    model: "gpt-5-mini",
    messages: [
      {
        role: "system",
        content:
          "You produce precise meeting intelligence. Use only facts stated in the transcript. Do not invent speakers, owners, dates, decisions, or commitments. Keep the overview concise. Include an action item only when the transcript contains an explicit or clearly agreed task.",
      },
      {
        role: "user",
        content: `Summarize this timestamped meeting transcript.\n\n${transcript}`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "meeting_summary",
        strict: true,
        schema: responseSchema,
      },
    },
  });

  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") {
    throw new Error("The summary service returned an invalid response");
  }
  return parseMeetingSummary(content);
}
