import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ported from the Manus meeting.lifecycle.test.ts, which drove these cases
 * through appRouter.createCaller. The router is gone; the invariants are not.
 *
 * The db module and the two summary generators are fully mocked so this file
 * exercises only the lifecycle logic in meetings.ts — and so importing it does
 * not drag in Capacitor or SQLite.
 */

const getMeeting = vi.fn();
const getMeetingDetail = vi.fn();
const listAudioChunkStatesForMeeting = vi.fn();
const failMeetingProcessing = vi.fn();
const saveMeetingSummary = vi.fn();
const purgeMeetingProcessingArtifacts = vi.fn();
const listCompletedMeetingsBetween = vi.fn();
const saveDailySummary = vi.fn();

vi.mock("@/lib/db", () => ({
  getMeeting,
  getMeetingDetail,
  listAudioChunkStatesForMeeting,
  failMeetingProcessing,
  saveMeetingSummary,
  purgeMeetingProcessingArtifacts,
  listCompletedMeetingsBetween,
  saveDailySummary,
}));

vi.mock("@/lib/transcription", () => ({
  transcribeAudioBlob: vi.fn(),
  isTranscriptionError: vi.fn(),
}));

const generateMeetingSummary = vi.fn();
vi.mock("./meetingSummary", () => ({ generateMeetingSummary }));
vi.mock("./dailySummary", () => ({ generateDailySummary: vi.fn() }));

const { getMeetingDetail: loadDetail, summarizeMeeting } = await import("./meetings");

function processingMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    title: "Untitled meeting",
    status: "processing",
    startedAtMs: 1_700_000_000_000,
    endedAtMs: 1_700_000_010_000,
    durationMs: 10_000,
    failureReason: null,
    summaryOverview: null,
    keyTopics: null,
    decisions: null,
    actionItems: null,
    summaryGeneratedAtMs: null,
    createdAtMs: 1_700_000_000_000,
    updatedAtMs: 1_700_000_010_000,
    ...overrides,
  };
}

const day = {
  localDate: "2026-07-18",
  timezone: "Australia/Sydney",
  dayStartAtMs: 1_700_000_000_000,
  dayEndAtMs: 1_700_086_400_000,
};

describe("meeting processing recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("turns a processing meeting with failed chunks into a durable failed state when it is reopened", async () => {
    listAudioChunkStatesForMeeting.mockResolvedValue([
      { id: 31, sequence: 0, transcriptionStatus: "completed", errorMessage: null },
      { id: 32, sequence: 1, transcriptionStatus: "failed", errorMessage: "Invalid file format" },
    ]);
    getMeeting.mockResolvedValue(processingMeeting());
    getMeetingDetail.mockResolvedValue({
      ...processingMeeting({
        status: "failed",
        failureReason: "1 audio section could not be transcribed.",
      }),
      segments: [],
    });

    const result = await loadDetail(8);

    expect(failMeetingProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 8,
        failureReason: expect.stringContaining("audio section"),
      }),
    );
    expect(result.status).toBe("failed");
  });

  it("refuses to generate a partial summary when any chunk is incomplete", async () => {
    getMeetingDetail.mockResolvedValue({
      ...processingMeeting(),
      segments: [{ id: 1, text: "Only the first part was transcribed." }],
    });
    listAudioChunkStatesForMeeting.mockResolvedValue([
      { id: 31, sequence: 0, transcriptionStatus: "completed", errorMessage: null },
      { id: 32, sequence: 1, transcriptionStatus: "failed", errorMessage: "Invalid file format" },
    ]);

    await expect(summarizeMeeting({ meetingId: 8, ...day })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(failMeetingProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 8,
        failureReason: expect.stringContaining("audio section"),
      }),
    );
    expect(generateMeetingSummary).not.toHaveBeenCalled();
  });

  it("keeps a tiny failed terminal fragment from blocking summary recovery", async () => {
    listAudioChunkStatesForMeeting.mockResolvedValue([
      {
        id: 31,
        sequence: 0,
        transcriptionStatus: "completed",
        errorMessage: null,
        sizeBytes: 42_000,
        durationMs: 10_000,
      },
      {
        id: 32,
        sequence: 1,
        transcriptionStatus: "failed",
        errorMessage: "The audio file could not be decoded.",
        sizeBytes: 110,
        durationMs: 500,
      },
    ]);
    getMeeting.mockResolvedValue(processingMeeting({ status: "failed" }));
    getMeetingDetail.mockResolvedValue({
      ...processingMeeting({ status: "failed" }),
      segments: [{ id: 1, text: "The substantive meeting transcript is preserved." }],
    });

    const result = await loadDetail(8);

    expect(result.retrySummaryAvailable).toBe(true);
    expect(failMeetingProcessing).not.toHaveBeenCalled();
  });

  it("purges audio and transcript only after the summary is durable", async () => {
    getMeetingDetail.mockResolvedValue({
      ...processingMeeting(),
      segments: [{ id: 1, startMs: 0, endMs: 1000, text: "A complete transcript." }],
    });
    listAudioChunkStatesForMeeting.mockResolvedValue([
      { id: 31, sequence: 0, transcriptionStatus: "completed", errorMessage: null },
    ]);
    generateMeetingSummary.mockRejectedValue(new Error("summary service unavailable"));

    await expect(summarizeMeeting({ meetingId: 8, ...day })).rejects.toThrow(
      "summary service unavailable",
    );

    // The transcript is the only way to retry, so it must survive a failure.
    expect(purgeMeetingProcessingArtifacts).not.toHaveBeenCalled();
    expect(failMeetingProcessing).toHaveBeenCalled();
  });
});
