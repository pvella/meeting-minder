# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape — read this first

Every file sits in a flat directory, but the code is written against a nested layout. Imports like
`../../drizzle/schema`, `@/components/ui/button`, and `./routers/meeting` do not resolve as checked in.
This is an extracted snapshot of a Manus WebDev template app (product name in `index.html` is
"Echo Ledger"), not a buildable tree.

There is **no `package.json`, no `vite.config`, no `tsconfig`, and no lockfile**, so there are no
verified build/lint/test commands. Do not invent them. If the user needs to run something, ask which
project directory the real tree lives in, or reconstruct the layout below first.

Reconstructed origin of each file, inferred from its own import statements:

| Flat file | Real path |
| --- | --- |
| `schema.ts` | `drizzle/schema.ts` |
| `meeting.ts`, `segmentation.ts`, `audioChunk.ts` | `shared/` |
| `llm.ts`, `voiceTranscription.ts` | `server/_core/` |
| `db.ts`, `storage.ts`, `routers.ts`, `*.test.ts` | `server/` |
| `audioTranscription.ts`, `meetingSummary.ts`, `dailySummary.ts` | `server/services/` |
| `App.tsx`, `index.css` | `src/` |
| `Home.tsx`, `MeetingHistory.tsx`, `MeetingDetail.tsx`, `DailySummaries.tsx` | `src/pages/` |
| `DashboardLayout.tsx` | `src/components/` |
| `useMeetingRecorder.ts`, `useAuth.ts` | `src/hooks/` |

**Referenced but absent** — expect to read or write these blind: `server/routers/meeting.ts` (the
`meetingRouter` / `dailySummaryRouter` that all the tests exercise), `server/_core/` (`env`, `trpc`,
`context`, `cookies`, `systemRouter`), `src/lib/trpc`, `src/components/ui/*` (shadcn), `src/pages/DailySummaryDetail`,
`src/contexts/ThemeContext`. `meeting-listener-models.json` is a captured `/v1/models` response, not app config.

## Stack

React + Vite + wouter + TanStack-Query-backed tRPC on the client; Express-style tRPC + Drizzle ORM
against **MySQL** on the server; Vitest for tests; shadcn/ui + Tailwind. Auth is Manus OAuth — users
are keyed by `openId`, and `ENV.ownerOpenId` auto-promotes one user to `admin` in `upsertUser`.

Both the LLM and Whisper calls go through one upstream gateway, Forge (`ENV.forgeApiUrl` /
`ENV.forgeApiKey`, default `https://forge.manus.im`), which speaks the OpenAI wire format. `llm.ts`
wraps `/v1/chat/completions`, `voiceTranscription.ts` + `audioTranscription.ts` wrap
`/v1/audio/transcriptions`, and `storage.ts` wraps presigned S3 PUT/GET.

## The recording pipeline

This is the core of the app and spans client and server.

1. **`useMeetingRecorder.ts`** (655 lines, the most intricate file) drives capture. It does *not* use
   MediaRecorder's timeslice. Instead it starts a **fresh `MediaRecorder` per 10s chunk**
   (`CHUNK_INTERVAL_MS`), stops it, and starts another — so each chunk is a standalone, independently
   decodable container. `recorderCycleRef` is a generation counter that cancels stale async
   continuations after a stop or split.
2. Each chunk is base64'd and sent via `meeting.transcribeChunk`. Chunks are tracked per meeting in
   `pendingByMeetingRef`; failures land in `failedChunksRef` keyed `meetingId:sequence` and are
   replayable via `retryFailedChunks()` without losing the recording.
3. **Silence auto-splits meetings.** `startAudioAnalysis` computes RMS per animation frame; when
   `shouldSplitForSilence` (in `segmentation.ts`, pure and unit-testable) returns true, the client
   calls `meeting.split`, which atomically closes the current meeting and opens a successor in one
   transaction (`splitMeetingForUser`). Recording never stops across a split.
4. Server transcribes the chunk and writes `transcriptSegments` with
   `sequence = chunkSequence * 1000 + index` — a sparse numbering scheme that keeps segments globally
   ordered without renumbering across chunks.
5. On stop or split, `summarizeAfterUploads` waits for all in-flight chunks, then calls
   `meeting.summarize`, which generates the meeting summary *and* regenerates that day's roll-up.

## Invariants worth preserving

- **Every query is scoped to `userId`, always as part of the `WHERE` clause** — never
  fetch-then-check. `meeting.privacy.test.ts` asserts this; `db.ts` follows it without exception.
- **No partial summaries.** If any audio chunk is not `completed`, summarization must throw
  `CONFLICT` and mark the meeting `failed` rather than summarize what it has. The one exception is
  encoded in `isIgnorableTerminalAudioFragment` (`audioChunk.ts`): a *final* chunk that is tiny
  (<1 KB), short (≤3 s), failed on a decode error, and follows at least one successful chunk is
  treated as recorder-teardown noise and does not block. `meeting.lifecycle.test.ts` covers all three
  paths.
- **Recovery on read.** Opening a stuck `processing` meeting re-derives its true state from chunk
  statuses and persists `failed` — the detail endpoint is a repair point, not just a getter.
- **Audio is transient.** `purgeMeetingProcessingArtifacts` deletes chunks and segments after
  summarization; the durable artifact is the summary. Keep this — it is the product's privacy claim,
  surfaced in the UI copy.
- **Summaries must not hallucinate.** Both `meetingSummary.ts` and `dailySummary.ts` use strict
  `json_schema` responses plus a system prompt forbidding invented owners, dates, or commitments, and
  validate with Zod after parsing. `dailySummary.ts` degrades to `buildDailySummaryFallback` (a
  mechanical, LLM-free roll-up) on any error, and always sources `actionItems` from the fallback
  rather than the model.
- Timestamps are `bigint` epoch-ms columns named `*AtMs`, not SQL `timestamp` — except on `users`.
- `getDb()` returns `null` when `DATABASE_URL` is unset so tooling can run DB-less; meeting paths call
  `requireDb()` instead and throw.

## Testing

Tests are Vitest, live beside `server/routers.ts`, and drive the API through
`appRouter.createCaller(ctx)` with a hand-built `TrpcContext` rather than HTTP. `./db` is mocked with
`vi.mock` + `importActual` so only the queried functions are stubbed, and `./routers` is imported
with a **top-level `await import()` after the mock is registered** — keep that ordering or the mock
won't apply.
