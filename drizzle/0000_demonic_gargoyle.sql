CREATE TABLE `audioChunks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meetingId` integer NOT NULL,
	`sequence` integer NOT NULL,
	`mimeType` text NOT NULL,
	`sizeBytes` integer NOT NULL,
	`startedAtMs` integer NOT NULL,
	`endedAtMs` integer NOT NULL,
	`durationMs` integer NOT NULL,
	`transcriptionStatus` text DEFAULT 'pending' NOT NULL,
	`errorMessage` text,
	`createdAtMs` integer NOT NULL,
	FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audio_chunks_meeting_sequence_uq` ON `audioChunks` (`meetingId`,`sequence`);--> statement-breakpoint
CREATE TABLE `dailySummaries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`localDate` text NOT NULL,
	`timezone` text NOT NULL,
	`status` text DEFAULT 'completed' NOT NULL,
	`overview` text NOT NULL,
	`highlights` text NOT NULL,
	`actionItems` text NOT NULL,
	`generatedAtMs` integer NOT NULL,
	`failureReason` text,
	`createdAtMs` integer NOT NULL,
	`updatedAtMs` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_summaries_date_uq` ON `dailySummaries` (`localDate`);--> statement-breakpoint
CREATE TABLE `meetings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text DEFAULT 'Untitled meeting' NOT NULL,
	`status` text DEFAULT 'recording' NOT NULL,
	`startedAtMs` integer NOT NULL,
	`endedAtMs` integer,
	`durationMs` integer DEFAULT 0 NOT NULL,
	`summaryOverview` text,
	`keyTopics` text,
	`decisions` text,
	`actionItems` text,
	`summaryGeneratedAtMs` integer,
	`failureReason` text,
	`createdAtMs` integer NOT NULL,
	`updatedAtMs` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meetings_started_idx` ON `meetings` (`startedAtMs`);--> statement-breakpoint
CREATE TABLE `transcriptSegments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`meetingId` integer NOT NULL,
	`audioChunkId` integer NOT NULL,
	`sequence` integer NOT NULL,
	`startMs` integer NOT NULL,
	`endMs` integer NOT NULL,
	`text` text NOT NULL,
	`createdAtMs` integer NOT NULL,
	FOREIGN KEY (`meetingId`) REFERENCES `meetings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`audioChunkId`) REFERENCES `audioChunks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcript_meeting_sequence_idx` ON `transcriptSegments` (`meetingId`,`sequence`);