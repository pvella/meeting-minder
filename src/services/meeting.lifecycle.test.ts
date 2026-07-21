import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getMeetingForUser = vi.fn();
const getMeetingDetailForUser = vi.fn();
const listAudioChunkStatesForMeeting = vi.fn();
const failMeetingProcessing = vi.fn();

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    getMeetingForUser,
    getMeetingDetailForUser,
    listAudioChunkStatesForMeeting,
    failMeetingProcessing,
  };
});

const { appRouter } = await import("./routers");

function contextFor(userId = 42): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `user-${userId}`,
      email: `user${userId}@example.com`,
      name: `User ${userId}`,
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function processingMeeting(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    userId: 42,
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
    updatedAtMs: Date.now(),
    ...overrides,
  };
}

describe("meeting processing recovery", () => {
  beforeEach(() => {
    getMeetingForUser.mockReset();
    getMeetingDetailForUser.mockReset();
    listAudioChunkStatesForMeeting.mockReset();
    failMeetingProcessing.mockReset();
  });

  it("changes a processing meeting with failed chunks into a durable failed state when it is reopened", async () => {
    getMeetingForUser
      .mockResolvedValueOnce(processingMeeting())
      .mockResolvedValueOnce(processingMeeting({ status: "failed", failureReason: "1 audio section could not be transcribed." }));
    listAudioChunkStatesForMeeting.mockResolvedValue([
      { id: 31, sequence: 0, transcriptionStatus: "completed", errorMessage: null },
      { id: 32, sequence: 1, transcriptionStatus: "failed", errorMessage: "Invalid file format" },
    ]);
    getMeetingDetailForUser.mockResolvedValue({
      ...processingMeeting({ status: "failed", failureReason: "1 audio section could not be transcribed." }),
      segments: [],
    });

    const caller = appRouter.createCaller(contextFor());
    const result = await caller.meeting.detail({ meetingId: 8 });

    expect(failMeetingProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 8,
        userId: 42,
        failureReason: expect.stringContaining("audio section"),
      }),
    );
    expect(result.status).toBe("failed");
  });

  it("refuses to generate a partial summary when any chunk is incomplete", async () => {
    getMeetingDetailForUser.mockResolvedValue({
      ...processingMeeting(),
      segments: [{ id: 1, text: "Only the first part was transcribed." }],
    });
    listAudioChunkStatesForMeeting.mockResolvedValue([
      { id: 31, sequence: 0, transcriptionStatus: "completed", errorMessage: null },
      { id: 32, sequence: 1, transcriptionStatus: "failed", errorMessage: "Invalid file format" },
    ]);

    const caller = appRouter.createCaller(contextFor());
    await expect(
      caller.meeting.summarize({
        meetingId: 8,
        localDate: "2026-07-18",
        timezone: "Australia/Sydney",
        dayStartAtMs: 1_700_000_000_000,
        dayEndAtMs: 1_700_086_400_000,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(failMeetingProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 8,
        userId: 42,
        failureReason: expect.stringContaining("audio section"),
      }),
    );
  });

  it("keeps a tiny failed terminal fragment from blocking summary recovery", async () => {
    getMeetingDetailForUser.mockResolvedValue({
      ...processingMeeting({ status: "failed" }),
      segments: [{ id: 1, text: "The substantive meeting transcript is preserved." }],
    });
    listAudioChunkStatesForMeeting.mockResolvedValue([
      { id: 31, sequence: 0, transcriptionStatus: "completed", errorMessage: null, sizeBytes: 42_000, durationMs: 10_000 },
      { id: 32, sequence: 1, transcriptionStatus: "failed", errorMessage: "The audio file could not be decoded.", sizeBytes: 110, durationMs: 500 },
    ]);

    const caller = appRouter.createCaller(contextFor());
    const result = await caller.meeting.detail({ meetingId: 8 });

    expect(result.retrySummaryAvailable).toBe(true);
    expect(failMeetingProcessing).not.toHaveBeenCalled();
  });
});
