import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type {
  ActionItem,
  DailySummaryContent,
  Decision,
  KeyTopic,
  MeetingSummary,
  TranscriptDraft,
} from "@shared/meeting";
import {
  audioChunks,
  dailySummaries,
  meetings,
  transcriptSegments,
} from "./schema";
import { db, withTransaction } from "./sqlite";

/**
 * On-device query layer. Ported from the Manus server's db.ts — the query
 * bodies are unchanged apart from the removal of every `userId` predicate,
 * which no longer exists (see schema.ts). Function names dropped their
 * `ForUser` suffix accordingly.
 */

export async function createMeeting(input: { startedAtMs: number }) {
  const now = Date.now();
  const [created] = await db
    .insert(meetings)
    .values({
      startedAtMs: input.startedAtMs,
      createdAtMs: now,
      updatedAtMs: now,
    })
    .returning({ id: meetings.id });

  return getMeeting(created.id);
}

export async function getMeeting(meetingId: number) {
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  return meeting;
}

export async function listMeetings() {
  return db.select().from(meetings).orderBy(desc(meetings.startedAtMs));
}

export async function getMeetingDetail(meetingId: number) {
  const meeting = await getMeeting(meetingId);
  if (!meeting) return undefined;

  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.meetingId, meetingId))
    .orderBy(asc(transcriptSegments.sequence));

  return { ...meeting, segments };
}

export async function addAudioChunk(input: {
  meetingId: number;
  sequence: number;
  mimeType: string;
  sizeBytes: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}) {
  const [created] = await db
    .insert(audioChunks)
    .values({
      ...input,
      transcriptionStatus: "processing",
      createdAtMs: Date.now(),
    })
    .returning({ id: audioChunks.id });
  return created.id;
}

export async function renameMeeting(input: {
  meetingId: number;
  title: string;
}) {
  await db
    .update(meetings)
    .set({ title: input.title, updatedAtMs: Date.now() })
    .where(eq(meetings.id, input.meetingId));
  return getMeeting(input.meetingId);
}

export async function listCompletedMeetingsBetween(input: {
  dayStartAtMs: number;
  dayEndAtMs: number;
}) {
  return db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "completed"),
        gte(meetings.startedAtMs, input.dayStartAtMs),
        lt(meetings.startedAtMs, input.dayEndAtMs),
      ),
    )
    .orderBy(asc(meetings.startedAtMs));
}

export async function getDailySummary(localDate: string) {
  const [summary] = await db
    .select()
    .from(dailySummaries)
    .where(eq(dailySummaries.localDate, localDate))
    .limit(1);
  return summary;
}

export async function listDailySummaries() {
  return db
    .select()
    .from(dailySummaries)
    .orderBy(desc(dailySummaries.localDate));
}

export async function saveDailySummary(input: {
  localDate: string;
  timezone: string;
  content: DailySummaryContent;
}) {
  const now = Date.now();
  await db
    .insert(dailySummaries)
    .values({
      localDate: input.localDate,
      timezone: input.timezone,
      status: "completed",
      overview: input.content.overview,
      highlights: input.content.highlights,
      actionItems: input.content.actionItems,
      generatedAtMs: now,
      failureReason: null,
      createdAtMs: now,
      updatedAtMs: now,
    })
    .onConflictDoUpdate({
      target: dailySummaries.localDate,
      set: {
        timezone: input.timezone,
        status: "completed",
        overview: input.content.overview,
        highlights: input.content.highlights,
        actionItems: input.content.actionItems,
        generatedAtMs: now,
        failureReason: null,
        updatedAtMs: now,
      },
    });
  return getDailySummary(input.localDate);
}

/**
 * Deletes the transient processing artifacts once a summary is durable. This is
 * the product's core privacy guarantee: the audio and raw transcript do not
 * outlive summarization.
 */
export async function purgeMeetingProcessingArtifacts(meetingId: number) {
  await withTransaction(async () => {
    await db
      .delete(transcriptSegments)
      .where(eq(transcriptSegments.meetingId, meetingId));
    await db.delete(audioChunks).where(eq(audioChunks.meetingId, meetingId));
  });
}

export async function getAudioChunkBySequence(input: {
  meetingId: number;
  sequence: number;
}) {
  const [chunk] = await db
    .select()
    .from(audioChunks)
    .where(
      and(
        eq(audioChunks.meetingId, input.meetingId),
        eq(audioChunks.sequence, input.sequence),
      ),
    )
    .limit(1);
  return chunk;
}

export async function listAudioChunkStatesForMeeting(meetingId: number) {
  return db
    .select({
      id: audioChunks.id,
      sequence: audioChunks.sequence,
      transcriptionStatus: audioChunks.transcriptionStatus,
      errorMessage: audioChunks.errorMessage,
      sizeBytes: audioChunks.sizeBytes,
      durationMs: audioChunks.durationMs,
    })
    .from(audioChunks)
    .where(eq(audioChunks.meetingId, meetingId))
    .orderBy(asc(audioChunks.sequence));
}

export async function getTranscriptSegmentsForAudioChunk(audioChunkId: number) {
  return db
    .select()
    .from(transcriptSegments)
    .where(eq(transcriptSegments.audioChunkId, audioChunkId))
    .orderBy(asc(transcriptSegments.sequence));
}

export async function markAudioChunkProcessing(audioChunkId: number) {
  await db
    .update(audioChunks)
    .set({ transcriptionStatus: "processing", errorMessage: null })
    .where(eq(audioChunks.id, audioChunkId));
}

export async function completeAudioChunkTranscription(input: {
  audioChunkId: number;
  meetingId: number;
  chunkStartedAtMs: number;
  chunkSequence: number;
  segments: TranscriptDraft[];
}) {
  const now = Date.now();

  await withTransaction(async () => {
    if (input.segments.length > 0) {
      await db.insert(transcriptSegments).values(
        input.segments.map((segment, index) => ({
          meetingId: input.meetingId,
          audioChunkId: input.audioChunkId,
          // Sparse numbering keeps segments globally ordered without
          // renumbering earlier chunks as later ones arrive.
          sequence: input.chunkSequence * 1000 + index,
          startMs: Math.max(0, input.chunkStartedAtMs + segment.startMs),
          endMs: Math.max(0, input.chunkStartedAtMs + segment.endMs),
          text: segment.text,
          createdAtMs: now,
        })),
      );
    }

    await db
      .update(audioChunks)
      .set({ transcriptionStatus: "completed", errorMessage: null })
      .where(eq(audioChunks.id, input.audioChunkId));

    await db
      .update(meetings)
      .set({ updatedAtMs: now })
      .where(eq(meetings.id, input.meetingId));
  });
}

export async function failAudioChunkTranscription(input: {
  audioChunkId: number;
  errorMessage: string;
}) {
  const [chunk] = await db
    .select({ meetingId: audioChunks.meetingId })
    .from(audioChunks)
    .where(eq(audioChunks.id, input.audioChunkId))
    .limit(1);
  const now = Date.now();

  await withTransaction(async () => {
    await db
      .update(audioChunks)
      .set({ transcriptionStatus: "failed", errorMessage: input.errorMessage })
      .where(eq(audioChunks.id, input.audioChunkId));
    if (chunk) {
      await db
        .update(meetings)
        .set({ updatedAtMs: now })
        .where(eq(meetings.id, chunk.meetingId));
    }
  });
}

export async function markMeetingProcessing(input: {
  meetingId: number;
  endedAtMs: number;
}) {
  const meeting = await getMeeting(input.meetingId);
  if (!meeting) return false;

  await db
    .update(meetings)
    .set({
      status: "processing",
      endedAtMs: input.endedAtMs,
      durationMs: Math.max(0, input.endedAtMs - meeting.startedAtMs),
      updatedAtMs: Date.now(),
      failureReason: null,
    })
    .where(eq(meetings.id, input.meetingId));
  return true;
}

/**
 * Closes the current meeting and opens its successor atomically, so a silence
 * boundary never leaves the recorder without a meeting to write into.
 */
export async function splitMeeting(input: {
  meetingId: number;
  endedAtMs: number;
  nextStartedAtMs: number;
}) {
  const meeting = await getMeeting(input.meetingId);
  if (!meeting) return undefined;
  const now = Date.now();

  const nextId = await withTransaction(async () => {
    await db
      .update(meetings)
      .set({
        status: "processing",
        endedAtMs: input.endedAtMs,
        durationMs: Math.max(0, input.endedAtMs - meeting.startedAtMs),
        updatedAtMs: now,
        failureReason: null,
      })
      .where(eq(meetings.id, input.meetingId));

    const [next] = await db
      .insert(meetings)
      .values({
        startedAtMs: input.nextStartedAtMs,
        createdAtMs: now,
        updatedAtMs: now,
      })
      .returning({ id: meetings.id });
    return next.id;
  });

  return getMeeting(nextId);
}

export async function saveMeetingSummary(input: {
  meetingId: number;
  summary: MeetingSummary;
}) {
  const now = Date.now();
  await db
    .update(meetings)
    .set({
      title: input.summary.suggestedTitle,
      summaryOverview: input.summary.overview,
      keyTopics: input.summary.keyTopics,
      decisions: input.summary.decisions,
      actionItems: input.summary.actionItems,
      summaryGeneratedAtMs: now,
      status: "completed",
      failureReason: null,
      updatedAtMs: now,
    })
    .where(eq(meetings.id, input.meetingId));
}

/**
 * Overwrites the generated summary with user-edited content. Deliberately does
 * not touch `summaryGeneratedAtMs` or `status`: this is a correction to an
 * existing summary, not a regeneration.
 */
export async function updateMeetingSummaryContent(input: {
  meetingId: number;
  summaryOverview: string;
  keyTopics: KeyTopic[];
  decisions: Decision[];
  actionItems: ActionItem[];
}) {
  await db
    .update(meetings)
    .set({
      summaryOverview: input.summaryOverview,
      keyTopics: input.keyTopics,
      decisions: input.decisions,
      actionItems: input.actionItems,
      updatedAtMs: Date.now(),
    })
    .where(eq(meetings.id, input.meetingId));
  return getMeeting(input.meetingId);
}

export async function updateMeetingActionItems(input: {
  meetingId: number;
  actionItems: ActionItem[];
}) {
  await db
    .update(meetings)
    .set({ actionItems: input.actionItems, updatedAtMs: Date.now() })
    .where(eq(meetings.id, input.meetingId));
  return getMeeting(input.meetingId);
}

/** Chunks and transcript segments go too, via ON DELETE CASCADE. */
export async function deleteMeeting(meetingId: number) {
  await db.delete(meetings).where(eq(meetings.id, meetingId));
}

export async function deleteDailySummary(localDate: string) {
  await db.delete(dailySummaries).where(eq(dailySummaries.localDate, localDate));
}

export async function failMeetingProcessing(input: {
  meetingId: number;
  failureReason: string;
}) {
  await db
    .update(meetings)
    .set({
      status: "failed",
      failureReason: input.failureReason,
      updatedAtMs: Date.now(),
    })
    .where(eq(meetings.id, input.meetingId));
}
