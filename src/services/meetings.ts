import { getBlockingAudioChunks } from "@shared/audioChunk";
import type {
  ActionItem,
  Decision,
  KeyTopic,
  LocalDay,
  TranscriptDraft,
} from "@shared/meeting";
import * as db from "@/lib/db";
import { isTranscriptionError, transcribeAudioBlob } from "@/lib/transcription";
import { buildDailySummaryFallback, generateDailySummary } from "./dailySummary";
import { generateMeetingSummary } from "./meetingSummary";

/**
 * Local replacement for the Manus `server/routers/meeting.ts`, which was not
 * part of the exported snapshot. The contract here was reconstructed from the
 * client call sites in useMeetingRecorder plus the behaviours asserted in
 * meeting.lifecycle.test.ts.
 */

export class ServiceError extends Error {
  constructor(
    public readonly code: "CONFLICT" | "NOT_FOUND" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

function describeBlockingChunks(count: number) {
  return `${count} audio section${count === 1 ? "" : "s"} could not be transcribed.`;
}

export async function createMeeting(input: { startedAtMs: number }) {
  const meeting = await db.createMeeting(input);
  if (!meeting) throw new ServiceError("BAD_REQUEST", "The meeting could not be created");
  return meeting;
}

export async function listMeetings() {
  return db.listMeetings();
}

/**
 * Reading a meeting is also a repair point. A meeting left in `processing` —
 * because the app was killed mid-summarization, say — is re-derived from its
 * chunk statuses and persisted as `failed`, rather than spinning forever.
 */
export async function getMeetingDetail(meetingId: number) {
  const chunks = await db.listAudioChunkStatesForMeeting(meetingId);
  const blocking = getBlockingAudioChunks(chunks);

  const current = await db.getMeeting(meetingId);
  if (!current) throw new ServiceError("NOT_FOUND", "Meeting not found");

  if (current.status === "processing" && blocking.length > 0) {
    await db.failMeetingProcessing({
      meetingId,
      failureReason: describeBlockingChunks(blocking.length),
    });
  }

  const detail = await db.getMeetingDetail(meetingId);
  if (!detail) throw new ServiceError("NOT_FOUND", "Meeting not found");

  return {
    ...detail,
    // Offer a retry only when the transcript is intact enough to summarize:
    // nothing still blocking, and something actually transcribed.
    retrySummaryAvailable:
      blocking.length === 0 &&
      detail.segments.length > 0 &&
      detail.status !== "completed",
  };
}

export async function renameMeeting(input: { meetingId: number; title: string }) {
  const title = input.title.trim();
  if (!title) throw new ServiceError("BAD_REQUEST", "A meeting title cannot be empty");
  const meeting = await db.renameMeeting({ meetingId: input.meetingId, title });
  if (!meeting) throw new ServiceError("NOT_FOUND", "Meeting not found");
  return meeting;
}

/**
 * Transcribes one audio chunk. Idempotent by (meetingId, sequence): a chunk
 * already transcribed returns its stored segments with `reused: true` so a
 * client-side retry cannot duplicate transcript rows or double-bill the API.
 */
export async function transcribeChunk(input: {
  meetingId: number;
  sequence: number;
  audio: Blob;
  mimeType: string;
  chunkStartedAtMs: number;
  chunkEndedAtMs: number;
  chunkOffsetMs: number;
}) {
  const existing = await db.getAudioChunkBySequence({
    meetingId: input.meetingId,
    sequence: input.sequence,
  });

  if (existing?.transcriptionStatus === "completed") {
    const segments = await db.getTranscriptSegmentsForAudioChunk(existing.id);
    return { reused: true as const, segments };
  }

  const audioChunkId =
    existing?.id ??
    (await db.addAudioChunk({
      meetingId: input.meetingId,
      sequence: input.sequence,
      mimeType: input.mimeType,
      sizeBytes: input.audio.size,
      startedAtMs: input.chunkStartedAtMs,
      endedAtMs: input.chunkEndedAtMs,
      durationMs: Math.max(0, input.chunkEndedAtMs - input.chunkStartedAtMs),
    }));

  if (existing) await db.markAudioChunkProcessing(audioChunkId);

  const result = await transcribeAudioBlob({
    audio: input.audio,
    mimeType: input.mimeType,
  });

  if (isTranscriptionError(result)) {
    await db.failAudioChunkTranscription({
      audioChunkId,
      errorMessage: result.details
        ? `${result.error}: ${result.details}`
        : result.error,
    });
    throw new Error(result.error);
  }

  const drafts: TranscriptDraft[] = (result.segments ?? [])
    .filter(segment => segment.text.trim().length > 0)
    .map((segment, index) => ({
      sequence: index,
      startMs: Math.round(segment.start * 1000),
      endMs: Math.round(segment.end * 1000),
      text: segment.text.trim(),
    }));

  await db.completeAudioChunkTranscription({
    audioChunkId,
    meetingId: input.meetingId,
    // Offsets are relative to the meeting start, not the wall clock, so the
    // transcript timeline still reads from 00:00:00 after a split.
    chunkStartedAtMs: input.chunkOffsetMs,
    chunkSequence: input.sequence,
    segments: drafts,
  });

  const segments = await db.getTranscriptSegmentsForAudioChunk(audioChunkId);
  return { reused: false as const, segments };
}

export async function finalizeMeeting(input: {
  meetingId: number;
  endedAtMs: number;
}) {
  const ok = await db.markMeetingProcessing(input);
  if (!ok) throw new ServiceError("NOT_FOUND", "Meeting not found");
  return { success: true as const };
}

export async function splitMeeting(input: {
  meetingId: number;
  endedAtMs: number;
  nextStartedAtMs: number;
}) {
  const next = await db.splitMeeting(input);
  if (!next) throw new ServiceError("NOT_FOUND", "Meeting not found");
  return next;
}

/**
 * Summarizes a meeting, then rebuilds that day's roll-up.
 *
 * Refuses to produce a partial summary: if any chunk is still unaccounted for,
 * the meeting is marked failed and this throws, rather than silently
 * summarizing half a conversation. The one tolerated exception is a tiny failed
 * terminal fragment — recorder teardown noise — which getBlockingAudioChunks
 * filters out.
 */
export async function summarizeMeeting(input: {
  meetingId: number;
  localDate: string;
  timezone: string;
  dayStartAtMs: number;
  dayEndAtMs: number;
}) {
  const detail = await db.getMeetingDetail(input.meetingId);
  if (!detail) throw new ServiceError("NOT_FOUND", "Meeting not found");

  const chunks = await db.listAudioChunkStatesForMeeting(input.meetingId);
  const blocking = getBlockingAudioChunks(chunks);

  if (blocking.length > 0) {
    const failureReason = describeBlockingChunks(blocking.length);
    await db.failMeetingProcessing({ meetingId: input.meetingId, failureReason });
    throw new ServiceError("CONFLICT", failureReason);
  }

  try {
    const summary = await generateMeetingSummary(detail.segments);
    await db.saveMeetingSummary({ meetingId: input.meetingId, summary });
  } catch (error) {
    await db.failMeetingProcessing({
      meetingId: input.meetingId,
      failureReason:
        error instanceof Error
          ? error.message
          : "The meeting summary could not be generated.",
    });
    throw error;
  }

  // Only once the summary is durable. This is the privacy guarantee: the audio
  // and raw transcript do not outlive summarization.
  await db.purgeMeetingProcessingArtifacts(input.meetingId);

  await rebuildDailySummary({
    localDate: input.localDate,
    timezone: input.timezone,
    dayStartAtMs: input.dayStartAtMs,
    dayEndAtMs: input.dayEndAtMs,
  });

  return db.getMeeting(input.meetingId);
}

export async function rebuildDailySummary(day: LocalDay) {
  const meetings = await db.listCompletedMeetingsBetween({
    dayStartAtMs: day.dayStartAtMs,
    dayEndAtMs: day.dayEndAtMs,
  });

  // Deleting the last meeting of a day should remove the day, not leave behind
  // a roll-up that says there was nothing to roll up.
  if (meetings.length === 0) {
    await db.deleteDailySummary(day.localDate);
    return undefined;
  }

  const content = await generateDailySummary(meetings);
  return db.saveDailySummary({
    localDate: day.localDate,
    timezone: day.timezone,
    content,
  });
}

/**
 * Applies user corrections to a summary. The day roll-up's *narrative* (overview
 * and highlights) is NOT regenerated here — that costs an LLM call. But the
 * roll-up's action items are only ever a mechanical flatten of each meeting's
 * items (never LLM-authored), so they are refreshed cheaply and for free so the
 * daily view matches the edit immediately. Pass `day` to enable that refresh.
 *
 * Editing also works on a meeting that failed to auto-summarize: if the user
 * supplies content by hand, the meeting is promoted to "completed" — they have
 * taken ownership of the summary.
 */
export async function updateMeetingSummary(input: {
  meetingId: number;
  summaryOverview: string;
  keyTopics: KeyTopic[];
  decisions: Decision[];
  actionItems: ActionItem[];
  day?: LocalDay;
}) {
  const existing = await db.getMeeting(input.meetingId);
  if (!existing) throw new ServiceError("NOT_FOUND", "Meeting not found");

  const overview = input.summaryOverview.trim();
  const keyTopics = input.keyTopics.filter(item => item.topic.trim());
  const decisions = input.decisions.filter(item => item.decision.trim());
  const actionItems = input.actionItems.filter(item => item.task.trim());

  // Empty overview is allowed (e.g. jotting action items onto a failed
  // meeting), but a wholly empty summary is not — that is just a blank record.
  const hasContent =
    Boolean(overview) || keyTopics.length > 0 || decisions.length > 0 || actionItems.length > 0;
  if (!hasContent) {
    throw new ServiceError("BAD_REQUEST", "Add a summary or at least one action item before saving.");
  }

  const saved = await db.updateMeetingSummaryContent({
    meetingId: input.meetingId,
    summaryOverview: overview,
    keyTopics,
    decisions,
    actionItems,
    // A hand-edited failed meeting becomes completed.
    markCompleted: existing.status !== "completed",
  });

  // Free, LLM-less refresh of the day roll-up's action items.
  if (input.day) {
    const existingDaily = await db.getDailySummary(input.day.localDate);
    if (existingDaily) {
      const dayMeetings = await db.listCompletedMeetingsBetween({
        dayStartAtMs: input.day.dayStartAtMs,
        dayEndAtMs: input.day.dayEndAtMs,
      });
      await db.updateDailySummaryActionItems({
        localDate: input.day.localDate,
        actionItems: buildDailySummaryFallback(dayMeetings).actionItems,
      });
    }
  }

  return saved;
}

/**
 * Ticks a single action item complete or open. Items have no stable id — they
 * are positional entries in the meeting's JSON array — so they are addressed by
 * (meetingId, index). The daily roll-up is intentionally not rebuilt: completion
 * is user bookkeeping, not a change to what the meeting was about, and rebuilding
 * costs an API call. The daily view reads completion straight from the meeting
 * rows it already links to.
 */
export async function setActionItemCompletion(input: {
  meetingId: number;
  index: number;
  completedAtMs: number | null;
}) {
  const meeting = await db.getMeeting(input.meetingId);
  if (!meeting) throw new ServiceError("NOT_FOUND", "Meeting not found");
  const actionItems = meeting.actionItems ?? [];
  const target = actionItems[input.index];
  if (!target) throw new ServiceError("NOT_FOUND", "Action item not found");

  const next = actionItems.map((item, position) =>
    position === input.index
      ? { ...item, completedAtMs: input.completedAtMs }
      : item,
  );
  return db.updateMeetingActionItems({
    meetingId: input.meetingId,
    actionItems: next,
  });
}

/**
 * Deletes a meeting and rebuilds that day's roll-up, which would otherwise go
 * on citing a meeting that no longer exists. Unlike an edit, this is rare and
 * leaving stale references would be actively wrong, so the API call is worth it.
 */
export async function deleteMeeting(input: { meetingId: number; day: LocalDay }) {
  const existing = await db.getMeeting(input.meetingId);
  if (!existing) throw new ServiceError("NOT_FOUND", "Meeting not found");

  await db.deleteMeeting(input.meetingId);
  await rebuildDailySummary(input.day);
  return { success: true as const };
}

export async function listDailySummaries() {
  return db.listDailySummaries();
}

export async function getDailySummaryDetail(localDate: string) {
  const summary = await db.getDailySummary(localDate);
  if (!summary) throw new ServiceError("NOT_FOUND", "No summary for that day");
  return summary;
}
