import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type {
  ActionItem,
  DailyActionItem,
  Decision,
  KeyTopic,
} from "@shared/meeting";

/**
 * On-device schema. This app is single-user by construction — the database
 * lives in the app's private storage and the OS is the security boundary — so
 * there is no `users` table and no `userId` column anywhere. The Manus build
 * scoped every query by userId; that guarantee now comes from the sandbox
 * rather than from a WHERE clause.
 *
 * All `*AtMs` columns are epoch milliseconds stored as SQLite INTEGER, which is
 * 64-bit and holds them without precision loss.
 */

export const meetings = sqliteTable(
  "meetings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull().default("Untitled meeting"),
    status: text("status", {
      enum: ["recording", "processing", "completed", "failed"],
    })
      .notNull()
      .default("recording"),
    startedAtMs: integer("startedAtMs").notNull(),
    endedAtMs: integer("endedAtMs"),
    durationMs: integer("durationMs").notNull().default(0),
    summaryOverview: text("summaryOverview"),
    keyTopics: text("keyTopics", { mode: "json" }).$type<KeyTopic[]>(),
    decisions: text("decisions", { mode: "json" }).$type<Decision[]>(),
    actionItems: text("actionItems", { mode: "json" }).$type<ActionItem[]>(),
    summaryGeneratedAtMs: integer("summaryGeneratedAtMs"),
    failureReason: text("failureReason"),
    createdAtMs: integer("createdAtMs").notNull(),
    updatedAtMs: integer("updatedAtMs").notNull(),
  },
  table => [index("meetings_started_idx").on(table.startedAtMs)],
);

export const audioChunks = sqliteTable(
  "audioChunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    meetingId: integer("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    mimeType: text("mimeType").notNull(),
    sizeBytes: integer("sizeBytes").notNull(),
    startedAtMs: integer("startedAtMs").notNull(),
    endedAtMs: integer("endedAtMs").notNull(),
    durationMs: integer("durationMs").notNull(),
    transcriptionStatus: text("transcriptionStatus", {
      enum: ["pending", "processing", "completed", "failed"],
    })
      .notNull()
      .default("pending"),
    errorMessage: text("errorMessage"),
    createdAtMs: integer("createdAtMs").notNull(),
  },
  table => [
    uniqueIndex("audio_chunks_meeting_sequence_uq").on(
      table.meetingId,
      table.sequence,
    ),
  ],
);

export const dailySummaries = sqliteTable(
  "dailySummaries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Unique on its own now that summaries are no longer partitioned by user.
    localDate: text("localDate").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status", { enum: ["completed", "failed"] })
      .notNull()
      .default("completed"),
    overview: text("overview").notNull(),
    highlights: text("highlights", { mode: "json" }).$type<string[]>().notNull(),
    actionItems: text("actionItems", { mode: "json" })
      .$type<DailyActionItem[]>()
      .notNull(),
    generatedAtMs: integer("generatedAtMs").notNull(),
    failureReason: text("failureReason"),
    createdAtMs: integer("createdAtMs").notNull(),
    updatedAtMs: integer("updatedAtMs").notNull(),
  },
  table => [uniqueIndex("daily_summaries_date_uq").on(table.localDate)],
);

export const transcriptSegments = sqliteTable(
  "transcriptSegments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    meetingId: integer("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    audioChunkId: integer("audioChunkId")
      .notNull()
      .references(() => audioChunks.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    startMs: integer("startMs").notNull(),
    endMs: integer("endMs").notNull(),
    text: text("text").notNull(),
    createdAtMs: integer("createdAtMs").notNull(),
  },
  table => [
    index("transcript_meeting_sequence_idx").on(table.meetingId, table.sequence),
  ],
);

export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = typeof meetings.$inferInsert;
export type AudioChunk = typeof audioChunks.$inferSelect;
export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
export type DailySummary = typeof dailySummaries.$inferSelect;
