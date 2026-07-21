import {
  bigint,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type {
  ActionItem,
  DailyActionItem,
  Decision,
  KeyTopic,
} from "../shared/meeting";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const meetings = mysqlTable(
  "meetings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull().default("Untitled meeting"),
    status: mysqlEnum("status", [
      "recording",
      "processing",
      "completed",
      "failed",
    ])
      .notNull()
      .default("recording"),
    startedAtMs: bigint("startedAtMs", { mode: "number" }).notNull(),
    endedAtMs: bigint("endedAtMs", { mode: "number" }),
    durationMs: int("durationMs").notNull().default(0),
    summaryOverview: text("summaryOverview"),
    keyTopics: json("keyTopics").$type<KeyTopic[]>(),
    decisions: json("decisions").$type<Decision[]>(),
    actionItems: json("actionItems").$type<ActionItem[]>(),
    summaryGeneratedAtMs: bigint("summaryGeneratedAtMs", { mode: "number" }),
    failureReason: text("failureReason"),
    createdAtMs: bigint("createdAtMs", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updatedAtMs", { mode: "number" }).notNull(),
  },
  table => ({
    userStartedIndex: index("meetings_user_started_idx").on(
      table.userId,
      table.startedAtMs,
    ),
  }),
);

export const audioChunks = mysqlTable(
  "audioChunks",
  {
    id: int("id").autoincrement().primaryKey(),
    meetingId: int("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sequence: int("sequence").notNull(),
    mimeType: varchar("mimeType", { length: 100 }).notNull(),
    sizeBytes: int("sizeBytes").notNull(),
    startedAtMs: bigint("startedAtMs", { mode: "number" }).notNull(),
    endedAtMs: bigint("endedAtMs", { mode: "number" }).notNull(),
    durationMs: int("durationMs").notNull(),
    transcriptionStatus: mysqlEnum("transcriptionStatus", [
      "pending",
      "processing",
      "completed",
      "failed",
    ])
      .notNull()
      .default("pending"),
    errorMessage: text("errorMessage"),
    createdAtMs: bigint("createdAtMs", { mode: "number" }).notNull(),
  },
  table => ({
    meetingSequenceUnique: uniqueIndex("audio_chunks_meeting_sequence_uq").on(
      table.meetingId,
      table.sequence,
    ),
    userMeetingIndex: index("audio_chunks_user_meeting_idx").on(
      table.userId,
      table.meetingId,
    ),
  }),
);

export const dailySummaries = mysqlTable(
  "dailySummaries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    localDate: varchar("localDate", { length: 10 }).notNull(),
    timezone: varchar("timezone", { length: 100 }).notNull(),
    status: mysqlEnum("status", ["completed", "failed"])
      .notNull()
      .default("completed"),
    overview: text("overview").notNull(),
    highlights: json("highlights").$type<string[]>().notNull(),
    actionItems: json("actionItems").$type<DailyActionItem[]>().notNull(),
    generatedAtMs: bigint("generatedAtMs", { mode: "number" }).notNull(),
    failureReason: text("failureReason"),
    createdAtMs: bigint("createdAtMs", { mode: "number" }).notNull(),
    updatedAtMs: bigint("updatedAtMs", { mode: "number" }).notNull(),
  },
  table => ({
    userDateUnique: uniqueIndex("daily_summaries_user_date_uq").on(
      table.userId,
      table.localDate,
    ),
    userDateIndex: index("daily_summaries_user_date_idx").on(
      table.userId,
      table.localDate,
    ),
  }),
);

export const transcriptSegments = mysqlTable(
  "transcriptSegments",
  {
    id: int("id").autoincrement().primaryKey(),
    meetingId: int("meetingId")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    audioChunkId: int("audioChunkId")
      .notNull()
      .references(() => audioChunks.id, { onDelete: "cascade" }),
    sequence: int("sequence").notNull(),
    startMs: int("startMs").notNull(),
    endMs: int("endMs").notNull(),
    text: text("text").notNull(),
    createdAtMs: bigint("createdAtMs", { mode: "number" }).notNull(),
  },
  table => ({
    meetingSequenceIndex: index("transcript_meeting_sequence_idx").on(
      table.meetingId,
      table.sequence,
    ),
    userMeetingIndex: index("transcript_user_meeting_idx").on(
      table.userId,
      table.meetingId,
    ),
  }),
);

export type Meeting = typeof meetings.$inferSelect;
export type InsertMeeting = typeof meetings.$inferInsert;
export type AudioChunk = typeof audioChunks.$inferSelect;
export type TranscriptSegment = typeof transcriptSegments.$inferSelect;
export type DailySummary = typeof dailySummaries.$inferSelect;
