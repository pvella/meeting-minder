# MeetingMinder

An Android app that records meetings, transcribes them as they happen, and turns them into
summaries you can actually use — topics, decisions, and action items — then **throws the
audio away**.

Everything lives on the phone. There is no server, no account, and no cloud database. The
only thing that leaves the device is audio sent to OpenAI for transcription, using an API key
you supply yourself.

---

## Why it exists

Most meeting tools keep a permanent recording of everything you say, on someone else's
infrastructure. MeetingMinder is built on the opposite assumption: **the recording is a means,
not the artifact.** Audio and raw transcript are deleted the moment a durable summary exists.
What survives is the part you'd actually reread.

---

## What it does

- **Records in short chunks** and transcribes each one during the meeting, so a transcript
  builds up live rather than after the fact.
- **Detects meeting boundaries automatically.** A sustained silence closes the current meeting
  and opens the next one without stopping the recording — useful for back-to-back sessions.
- **Summarizes each meeting** into an overview, key topics, decisions, and action items with
  owners and due dates.
- **Rolls each day up** into a single summary connecting themes across every meeting.
- **Lets you correct the AI.** Summaries and action items are editable; models get names wrong.
- **Deletes audio and transcript** once the summary is safely stored.

---

## Privacy model

This is the part worth being precise about, because "private" is easy to claim.

| Data | Where it lives | Lifetime |
| --- | --- | --- |
| Audio chunks | Device SQLite, then OpenAI for transcription | Deleted after summarization |
| Transcript segments | Device SQLite | Deleted after summarization |
| Summaries | Device SQLite | Kept until you delete the meeting |
| OpenAI API key | Capacitor Preferences (app-private storage) | Until you change it |

**Audio does leave the device.** It is sent to OpenAI's transcription endpoint. OpenAI does not
train on API data by default and retains it for a limited window for abuse monitoring. If that
is unacceptable for your meetings, this app is not currently for you — running transcription
locally would require a different architecture.

Nothing else is transmitted. There is no analytics, no telemetry, no crash reporting, and no
backend of any kind. Fonts are bundled rather than fetched, so the app makes no network call at
launch.

---

## Requirements

- An **OpenAI API key** ([platform.openai.com](https://platform.openai.com/api-keys))
- **Node.js 20+** and npm
- **Android Studio** (for the SDK, and a JDK)
- An Android device or emulator, API 23+

---

## Getting started

```bash
git clone git@github.com:pvella/meeting-minder.git
cd meeting-minder
npm install
```

### Run in a browser (fastest for UI work)

```bash
npm run dev
```

SQLite runs via `jeep-sqlite`/wasm in the browser, so the data layer behaves realistically.
Microphone capture works, but background throttling makes the browser a poor place to test
actual recording.

### Run on Android

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
npm run android          # builds, syncs, opens Android Studio
```

Or build and install directly:

```bash
npm run sync
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

On first launch the app asks for your OpenAI key and microphone permission. The key is stored
in app-private storage and is never written to the repository or transmitted anywhere except
OpenAI.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the test suite |
| `npm test -- -t "partial summary"` | Run a single test by name |
| `npm run db:generate` | Regenerate SQL migrations after editing the schema |
| `npm run sync` | Build and copy web assets into the Android project |
| `npm run android` | Sync and open Android Studio |

---

## How it works

**Recording.** Rather than using MediaRecorder's timeslice, the app starts a *fresh*
`MediaRecorder` for each ~10 second chunk and stops it. Each chunk is therefore a standalone,
independently decodable container, which means a single failed upload can be retried in
isolation without corrupting the stream.

**Transcription.** Chunks are posted to OpenAI's `whisper-1` model with
`response_format: verbose_json`. That format is required, not incidental — it is the only one
that returns per-segment timestamps, which the transcript timeline is built from. Transcription
is idempotent per `(meetingId, sequence)`, so a retry cannot duplicate rows or double-bill.

**Segmentation.** RMS audio level is sampled continuously. Once a meeting has run past a
minimum length, a sustained silence triggers an atomic split: the current meeting is closed and
a successor opened in one transaction, so the recorder is never left without somewhere to write.

**Summarization.** Transcript segments go to a chat model with a strict JSON schema and a prompt
forbidding invented owners, dates, or commitments. The response is validated with Zod before it
is stored. The daily roll-up degrades to a mechanical, LLM-free fallback if the model call fails.

**Cleanup.** Only once a summary is durably written are the audio chunks and transcript segments
deleted — never before, since the transcript is the only thing that makes a retry possible.

---

## Known limitations

**Recording only works while the app is in the foreground.** This is the significant one.
Silence detection runs on `requestAnimationFrame` and chunk rotation on `setTimeout`; both stop
or throttle when the screen sleeps or the app is backgrounded. A screen wake lock is held while
recording, but switching to another app will degrade capture silently.

Fixing this properly requires a native foreground service with
`foregroundServiceType="microphone"` (mandatory from Android 14), which means moving audio
capture and level analysis into Kotlin. It is deliberately deferred.

Other current limits:

- Single user, single device. No sync, no backup, no export.
- The transcript cannot be edited, because it no longer exists once a summary is written.
- Editing a summary does not rebuild that day's roll-up — that would cost an API call for every
  correction. The roll-up refreshes next time a meeting that day is summarized or deleted.
- Long sessions are lightly tested.

---

## Cost

Roughly **$0.36 per hour** of meeting, essentially all transcription (`whisper-1` at
$0.006/minute). Summarization is a fraction of a cent per meeting.

The transcription cost is effectively fixed: cheaper models exist but do not return the
timestamped segments this app depends on.

---

## Project structure

```
src/
├── components/       UI, including the summary editor and API-key gate
├── contexts/         Theme provider
├── hooks/
│   └── useMeetingRecorder.ts   Capture, chunking, silence detection, retry
├── lib/
│   ├── db.ts         Drizzle queries
│   ├── schema.ts     SQLite schema (source of truth for migrations)
│   ├── sqlite.ts     Connection, migrations, transactions
│   ├── openai.ts     Chat completions client
│   ├── transcription.ts  Whisper client
│   ├── queries.ts    TanStack Query bindings
│   └── settings.ts   API key and model storage
├── pages/            Record, meeting history, meeting detail, daily summaries
├── services/         Meeting lifecycle and summary generation
└── shared/           Pure logic: segmentation, chunk classification, types
drizzle/              Generated SQL migrations, applied on app start
android/              Capacitor Android project
```

`CLAUDE.md` documents the architecture in more depth, including the invariants worth preserving
and the sharp edges in the SQLite driver.

---

## Testing

```bash
npm test
```

Tests focus on the meeting lifecycle — the rules that matter most and are easiest to break:

- A meeting with untranscribed audio must never be summarized partially.
- A tiny failed *final* chunk is recorder teardown noise and must not block a summary.
- A stuck `processing` meeting repairs itself to `failed` when reopened.
- Audio and transcript survive a failed summarization, since they are the only route to a retry.
- Deleting a day's last meeting removes the day, rather than leaving an empty roll-up.

---

## Provenance

MeetingMinder was originally built on the Manus WebDev platform and later detached into a
standalone app. The migration replaced the tRPC server with local services, MySQL with on-device
SQLite, and platform-hosted AI with direct OpenAI calls, and removed authentication entirely.
The first commit is the original Manus export, preserved for comparison.
