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
const deleteMeetingRow = vi.fn();
const deleteDailySummary = vi.fn();
const updateMeetingSummaryContent = vi.fn();
const updateMeetingActionItems = vi.fn();

vi.mock("@/lib/db", () => ({
  getMeeting,
  getMeetingDetail,
  listAudioChunkStatesForMeeting,
  failMeetingProcessing,
  saveMeetingSummary,
  purgeMeetingProcessingArtifacts,
  listCompletedMeetingsBetween,
  saveDailySummary,
  deleteMeeting: deleteMeetingRow,
  deleteDailySummary,
  updateMeetingSummaryContent,
  updateMeetingActionItems,
}));

vi.mock("@/lib/transcription", () => ({
  transcribeAudioBlob: vi.fn(),
  isTranscriptionError: vi.fn(),
}));

const generateMeetingSummary = vi.fn();
const generateDailySummary = vi.fn();
vi.mock("./meetingSummary", () => ({ generateMeetingSummary }));
vi.mock("./dailySummary", () => ({ generateDailySummary }));

const {
  getMeetingDetail: loadDetail,
  summarizeMeeting,
  deleteMeeting,
  updateMeetingSummary,
  setActionItemCompletion,
} = await import("./meetings");

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

describe("editing and deleting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMeeting.mockResolvedValue(processingMeeting({ status: "completed" }));
  });

  it("drops blanked-out rows instead of persisting empty entries", async () => {
    await updateMeetingSummary({
      meetingId: 8,
      summaryOverview: "  A corrected overview.  ",
      keyTopics: [
        { topic: "Real topic", details: "Details" },
        { topic: "   ", details: "orphaned details" },
      ],
      decisions: [{ decision: "", context: "no decision" }],
      actionItems: [{ task: "Do the thing", owner: "Paul", dueDate: "Friday" }],
    });

    expect(updateMeetingSummaryContent).toHaveBeenCalledWith(
      expect.objectContaining({
        summaryOverview: "A corrected overview.",
        keyTopics: [{ topic: "Real topic", details: "Details" }],
        decisions: [],
        actionItems: [{ task: "Do the thing", owner: "Paul", dueDate: "Friday" }],
      }),
    );
  });

  it("does not spend an API call rebuilding the day when a summary is edited", async () => {
    await updateMeetingSummary({
      meetingId: 8,
      summaryOverview: "Corrected.",
      keyTopics: [],
      decisions: [],
      actionItems: [],
    });

    expect(generateDailySummary).not.toHaveBeenCalled();
    expect(saveDailySummary).not.toHaveBeenCalled();
  });

  it("rejects an empty overview", async () => {
    await expect(
      updateMeetingSummary({
        meetingId: 8,
        summaryOverview: "   ",
        keyTopics: [],
        decisions: [],
        actionItems: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(updateMeetingSummaryContent).not.toHaveBeenCalled();
  });

  it("rebuilds the day's roll-up after a delete so it stops citing the meeting", async () => {
    listCompletedMeetingsBetween.mockResolvedValue([
      processingMeeting({ id: 9, status: "completed" }),
    ]);
    generateDailySummary.mockResolvedValue({
      overview: "o",
      highlights: [],
      actionItems: [],
    });

    await deleteMeeting({ meetingId: 8, day });

    expect(deleteMeetingRow).toHaveBeenCalledWith(8);
    expect(saveDailySummary).toHaveBeenCalled();
  });

  it("removes the day entirely when its last meeting is deleted", async () => {
    listCompletedMeetingsBetween.mockResolvedValue([]);

    await deleteMeeting({ meetingId: 8, day });

    // Otherwise the day survives as a roll-up announcing it has nothing to say.
    expect(deleteDailySummary).toHaveBeenCalledWith(day.localDate);
    expect(saveDailySummary).not.toHaveBeenCalled();
    expect(generateDailySummary).not.toHaveBeenCalled();
  });
});

describe("action item completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMeeting.mockResolvedValue(
      processingMeeting({
        status: "completed",
        actionItems: [
          { task: "Rotate the keys", owner: "Paul", dueDate: "Friday", topic: "Security" },
          { task: "Draft the message", owner: "Olivia", dueDate: "Monday", topic: "BHP" },
        ],
      }),
    );
  });

  it("ticks a single item complete by index, leaving its siblings untouched", async () => {
    await setActionItemCompletion({ meetingId: 8, index: 1, completedAtMs: 1_700_000_050_000 });

    expect(updateMeetingActionItems).toHaveBeenCalledWith({
      meetingId: 8,
      actionItems: [
        { task: "Rotate the keys", owner: "Paul", dueDate: "Friday", topic: "Security" },
        {
          task: "Draft the message",
          owner: "Olivia",
          dueDate: "Monday",
          topic: "BHP",
          completedAtMs: 1_700_000_050_000,
        },
      ],
    });
  });

  it("reopens an item by clearing its completion timestamp", async () => {
    getMeeting.mockResolvedValue(
      processingMeeting({
        status: "completed",
        actionItems: [
          { task: "Rotate the keys", owner: "Paul", dueDate: "Friday", topic: "Security", completedAtMs: 123 },
        ],
      }),
    );

    await setActionItemCompletion({ meetingId: 8, index: 0, completedAtMs: null });

    expect(updateMeetingActionItems).toHaveBeenCalledWith({
      meetingId: 8,
      actionItems: [
        { task: "Rotate the keys", owner: "Paul", dueDate: "Friday", topic: "Security", completedAtMs: null },
      ],
    });
  });

  it("does not rebuild the day's roll-up when an item is ticked", async () => {
    await setActionItemCompletion({ meetingId: 8, index: 0, completedAtMs: 1 });

    expect(generateDailySummary).not.toHaveBeenCalled();
    expect(saveDailySummary).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range index rather than corrupting the list", async () => {
    await expect(
      setActionItemCompletion({ meetingId: 8, index: 5, completedAtMs: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updateMeetingActionItems).not.toHaveBeenCalled();
  });
});
