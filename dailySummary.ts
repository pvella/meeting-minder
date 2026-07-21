import { z } from "zod";
import type { Meeting } from "../../drizzle/schema";
import type { DailySummaryContent } from "../../shared/meeting";
import { invokeLLM } from "../_core/llm";

const dailySummarySchema = z.object({
  overview: z.string().min(1),
  highlights: z.array(z.string().min(1)),
});

function formatMeeting(meeting: Meeting) {
  return JSON.stringify({
    meetingId: meeting.id,
    title: meeting.title,
    startedAtMs: meeting.startedAtMs,
    durationMs: meeting.durationMs,
    overview: meeting.summaryOverview,
    keyTopics: meeting.keyTopics ?? [],
    decisions: meeting.decisions ?? [],
    actionItems: meeting.actionItems ?? [],
  });
}

export function buildDailySummaryFallback(
  meetings: Meeting[],
): DailySummaryContent {
  if (meetings.length === 0) {
    return {
      overview: "No completed meetings were recorded for this day.",
      highlights: [],
      actionItems: [],
    };
  }
  const meetingWord = meetings.length === 1 ? "meeting" : "meetings";
  return {
    overview: `${meetings.length} ${meetingWord} were summarized for this day. Open the linked meeting summaries for the complete context.`,
    highlights: meetings.map(
      meeting => `${meeting.title}: ${meeting.summaryOverview ?? "Summary completed."}`,
    ),
    actionItems: meetings.flatMap(meeting =>
      (meeting.actionItems ?? []).map(item => ({
        meetingId: meeting.id,
        task: item.task,
        owner: item.owner,
        dueDate: item.dueDate,
      })),
    ),
  };
}

export async function generateDailySummary(
  meetings: Meeting[],
): Promise<DailySummaryContent> {
  if (meetings.length === 0) return buildDailySummaryFallback(meetings);

  try {
    const response = await invokeLLM({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content:
            "Create a concise daily roll-up from meeting summaries. Use only supplied facts. Focus on themes, decisions, progress, and dependencies across the day. Do not repeat every meeting verbatim.",
        },
        {
          role: "user",
          content: meetings.map(formatMeeting).join("\n"),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "daily_summary",
          strict: true,
          schema: {
            type: "object",
            properties: {
              overview: { type: "string" },
              highlights: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["overview", "highlights"],
            additionalProperties: false,
          },
        },
      },
    });
    const content = response.choices[0]?.message.content;
    if (typeof content !== "string") {
      throw new Error("The daily summary service returned an invalid response");
    }
    const parsed = dailySummarySchema.parse(JSON.parse(content));
    return {
      ...parsed,
      actionItems: buildDailySummaryFallback(meetings).actionItems,
    };
  } catch (error) {
    console.warn(
      "[DailySummary] AI roll-up unavailable; using linked summary fallback",
      error,
    );
    return buildDailySummaryFallback(meetings);
  }
}
