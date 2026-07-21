import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  audioChunks,
  dailySummaries,
  InsertUser,
  meetings,
  transcriptSegments,
  users,
} from "../drizzle/schema";
import type {
  DailySummaryContent,
  MeetingSummary,
  TranscriptDraft,
} from "../shared/meeting";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db;
}

export async function createMeetingForUser(input: {
  userId: number;
  startedAtMs: number;
}) {
  const db = await requireDb();
  const now = Date.now();
  const [created] = await db
    .insert(meetings)
    .values({
      userId: input.userId,
      startedAtMs: input.startedAtMs,
      createdAtMs: now,
      updatedAtMs: now,
    })
    .$returningId();

  return getMeetingForUser(created.id, input.userId);
}

export async function getMeetingForUser(meetingId: number, userId: number) {
  const db = await requireDb();
  const [meeting] = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.id, meetingId), eq(meetings.userId, userId)))
    .limit(1);
  return meeting;
}

export async function listMeetingsForUser(userId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(meetings)
    .where(eq(meetings.userId, userId))
    .orderBy(desc(meetings.startedAtMs));
}

export async function getMeetingDetailForUser(meetingId: number, userId: number) {
  const db = await requireDb();
  const meeting = await getMeetingForUser(meetingId, userId);
  if (!meeting) return undefined;

  const segments = await db
    .select()
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.meetingId, meetingId),
        eq(transcriptSegments.userId, userId),
      ),
    )
    .orderBy(asc(transcriptSegments.sequence));

  return { ...meeting, segments };
}

export async function addAudioChunkForUser(input: {
  meetingId: number;
  userId: number;
  sequence: number;
  mimeType: string;
  sizeBytes: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
}) {
  const db = await requireDb();
  const [created] = await db
    .insert(audioChunks)
    .values({
      ...input,
      transcriptionStatus: "processing",
      createdAtMs: Date.now(),
    })
    .$returningId();
  return created.id;
}

export async function renameMeetingForUser(input: {
  meetingId: number;
  userId: number;
  title: string;
}) {
  const db = await requireDb();
  await db
    .update(meetings)
    .set({ title: input.title, updatedAtMs: Date.now() })
    .where(
      and(
        eq(meetings.id, input.meetingId),
        eq(meetings.userId, input.userId),
      ),
    );
  return getMeetingForUser(input.meetingId, input.userId);
}

export async function listCompletedMeetingsForUserBetween(input: {
  userId: number;
  dayStartAtMs: number;
  dayEndAtMs: number;
}) {
  const db = await requireDb();
  return db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.userId, input.userId),
        eq(meetings.status, "completed"),
        gte(meetings.startedAtMs, input.dayStartAtMs),
        lt(meetings.startedAtMs, input.dayEndAtMs),
      ),
    )
    .orderBy(asc(meetings.startedAtMs));
}

export async function getDailySummaryForUser(input: {
  userId: number;
  localDate: string;
}) {
  const db = await requireDb();
  const [summary] = await db
    .select()
    .from(dailySummaries)
    .where(
      and(
        eq(dailySummaries.userId, input.userId),
        eq(dailySummaries.localDate, input.localDate),
      ),
    )
    .limit(1);
  return summary;
}

export async function listDailySummariesForUser(userId: number) {
  const db = await requireDb();
  return db
    .select()
    .from(dailySummaries)
    .where(eq(dailySummaries.userId, userId))
    .orderBy(desc(dailySummaries.localDate));
}

export async function saveDailySummary(input: {
  userId: number;
  localDate: string;
  timezone: string;
  content: DailySummaryContent;
}) {
  const db = await requireDb();
  const now = Date.now();
  await db
    .insert(dailySummaries)
    .values({
      userId: input.userId,
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
    .onDuplicateKeyUpdate({
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
  return getDailySummaryForUser({
    userId: input.userId,
    localDate: input.localDate,
  });
}

export async function purgeMeetingProcessingArtifacts(input: {
  meetingId: number;
  userId: number;
}) {
  const db = await requireDb();
  await db.transaction(async tx => {
    await tx
      .delete(transcriptSegments)
      .where(
        and(
          eq(transcriptSegments.meetingId, input.meetingId),
          eq(transcriptSegments.userId, input.userId),
        ),
      );
    await tx
      .delete(audioChunks)
      .where(
        and(
          eq(audioChunks.meetingId, input.meetingId),
          eq(audioChunks.userId, input.userId),
        ),
      );
  });
}

export async function getAudioChunkForUserBySequence(input: {
  meetingId: number;
  userId: number;
  sequence: number;
}) {
  const db = await requireDb();
  const [chunk] = await db
    .select()
    .from(audioChunks)
    .where(
      and(
        eq(audioChunks.meetingId, input.meetingId),
        eq(audioChunks.userId, input.userId),
        eq(audioChunks.sequence, input.sequence),
      ),
    )
    .limit(1);
  return chunk;
}

export async function listAudioChunkStatesForMeeting(input: {
  meetingId: number;
  userId: number;
}) {
  const db = await requireDb();
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
    .where(
      and(
        eq(audioChunks.meetingId, input.meetingId),
        eq(audioChunks.userId, input.userId),
      ),
    )
    .orderBy(asc(audioChunks.sequence));
}

export async function getTranscriptSegmentsForAudioChunk(input: {
  audioChunkId: number;
  userId: number;
}) {
  const db = await requireDb();
  return db
    .select()
    .from(transcriptSegments)
    .where(
      and(
        eq(transcriptSegments.audioChunkId, input.audioChunkId),
        eq(transcriptSegments.userId, input.userId),
      ),
    )
    .orderBy(asc(transcriptSegments.sequence));
}

export async function markAudioChunkProcessing(input: {
  audioChunkId: number;
  userId: number;
}) {
  const db = await requireDb();
  await db
    .update(audioChunks)
    .set({ transcriptionStatus: "processing", errorMessage: null })
    .where(
      and(
        eq(audioChunks.id, input.audioChunkId),
        eq(audioChunks.userId, input.userId),
      ),
    );
}

export async function completeAudioChunkTranscription(input: {
  audioChunkId: number;
  meetingId: number;
  userId: number;
  chunkStartedAtMs: number;
  chunkSequence: number;
  segments: TranscriptDraft[];
}) {
  const db = await requireDb();
  const now = Date.now();

  await db.transaction(async tx => {
    if (input.segments.length > 0) {
      await tx.insert(transcriptSegments).values(
        input.segments.map((segment, index) => ({
          meetingId: input.meetingId,
          userId: input.userId,
          audioChunkId: input.audioChunkId,
          sequence: input.chunkSequence * 1000 + index,
          startMs: Math.max(0, input.chunkStartedAtMs + segment.startMs),
          endMs: Math.max(0, input.chunkStartedAtMs + segment.endMs),
          text: segment.text,
          createdAtMs: now,
        })),
      );
    }

    await tx
      .update(audioChunks)
      .set({ transcriptionStatus: "completed", errorMessage: null })
      .where(
        and(
          eq(audioChunks.id, input.audioChunkId),
          eq(audioChunks.userId, input.userId),
        ),
      );

    await tx
      .update(meetings)
      .set({ updatedAtMs: now })
      .where(
        and(
          eq(meetings.id, input.meetingId),
          eq(meetings.userId, input.userId),
        ),
      );
  });
}

export async function failAudioChunkTranscription(input: {
  audioChunkId: number;
  userId: number;
  errorMessage: string;
}) {
  const db = await requireDb();
  const [chunk] = await db
    .select({ meetingId: audioChunks.meetingId })
    .from(audioChunks)
    .where(
      and(
        eq(audioChunks.id, input.audioChunkId),
        eq(audioChunks.userId, input.userId),
      ),
    )
    .limit(1);
  const now = Date.now();
  await db.transaction(async tx => {
    await tx
      .update(audioChunks)
      .set({ transcriptionStatus: "failed", errorMessage: input.errorMessage })
      .where(
        and(
          eq(audioChunks.id, input.audioChunkId),
          eq(audioChunks.userId, input.userId),
        ),
      );
    if (chunk) {
      await tx
        .update(meetings)
        .set({ updatedAtMs: now })
        .where(
          and(
            eq(meetings.id, chunk.meetingId),
            eq(meetings.userId, input.userId),
          ),
        );
    }
  });
}

export async function markMeetingProcessing(input: {
  meetingId: number;
  userId: number;
  endedAtMs: number;
}) {
  const db = await requireDb();
  const meeting = await getMeetingForUser(input.meetingId, input.userId);
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
    .where(
      and(
        eq(meetings.id, input.meetingId),
        eq(meetings.userId, input.userId),
      ),
    );
  return true;
}

export async function splitMeetingForUser(input: {
  meetingId: number;
  userId: number;
  endedAtMs: number;
  nextStartedAtMs: number;
}) {
  const db = await requireDb();
  const meeting = await getMeetingForUser(input.meetingId, input.userId);
  if (!meeting) return undefined;
  const now = Date.now();

  const nextId = await db.transaction(async tx => {
    await tx
      .update(meetings)
      .set({
        status: "processing",
        endedAtMs: input.endedAtMs,
        durationMs: Math.max(0, input.endedAtMs - meeting.startedAtMs),
        updatedAtMs: now,
        failureReason: null,
      })
      .where(
        and(
          eq(meetings.id, input.meetingId),
          eq(meetings.userId, input.userId),
        ),
      );

    const [next] = await tx
      .insert(meetings)
      .values({
        userId: input.userId,
        startedAtMs: input.nextStartedAtMs,
        createdAtMs: now,
        updatedAtMs: now,
      })
      .$returningId();
    return next.id;
  });

  return getMeetingForUser(nextId, input.userId);
}

export async function saveMeetingSummary(input: {
  meetingId: number;
  userId: number;
  summary: MeetingSummary;
}) {
  const db = await requireDb();
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
    .where(
      and(
        eq(meetings.id, input.meetingId),
        eq(meetings.userId, input.userId),
      ),
    );
}

export async function failMeetingProcessing(input: {
  meetingId: number;
  userId: number;
  failureReason: string;
}) {
  const db = await requireDb();
  await db
    .update(meetings)
    .set({
      status: "failed",
      failureReason: input.failureReason,
      updatedAtMs: Date.now(),
    })
    .where(
      and(
        eq(meetings.id, input.meetingId),
        eq(meetings.userId, input.userId),
      ),
    );
}
