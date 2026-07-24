import { describe, expect, it } from "vitest";
import { parseBackup, planRestore, type BackupFile } from "./backup";

function meeting(id: number, startedAtMs: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Meeting ${id}`,
    status: "completed",
    startedAtMs,
    endedAtMs: startedAtMs + 1000,
    durationMs: 1000,
    summaryOverview: "overview",
    keyTopics: [{ title: "T", summary: "s" }],
    decisions: [{ decision: "d", context: "c" }],
    actionItems: [{ task: "Do the thing", owner: "Paul", dueDate: "" }],
    summaryGeneratedAtMs: startedAtMs + 2000,
    failureReason: null,
    createdAtMs: startedAtMs,
    updatedAtMs: startedAtMs,
    ...extra,
  } as unknown as BackupFile["meetings"][number];
}

function daily(id: number, localDate: string) {
  return {
    id,
    localDate,
    timezone: "Australia/Sydney",
    status: "completed",
    overview: "day overview",
    highlights: ["h1"],
    actionItems: [{ task: "Follow up", owner: "Paul", dueDate: "", meetingTitle: "M" }],
    generatedAtMs: 1,
    failureReason: null,
    createdAtMs: 1,
    updatedAtMs: 1,
  } as unknown as BackupFile["dailySummaries"][number];
}

function backup(meetings: BackupFile["meetings"], dailySummaries: BackupFile["dailySummaries"] = []): BackupFile {
  return { kind: "unrecorded-backup", version: 1, exportedAtMs: 123, meetings, dailySummaries };
}

describe("parseBackup", () => {
  it("accepts a well-formed backup", () => {
    const text = JSON.stringify(backup([meeting(1, 1000)]));
    expect(parseBackup(text).meetings).toHaveLength(1);
  });

  it("rejects non-JSON", () => {
    expect(() => parseBackup("{not json")).toThrow(/JSON/);
  });

  it("rejects a file that isn't an UnRecorded backup", () => {
    expect(() => parseBackup(JSON.stringify({ hello: "world" }))).toThrow(
      /UnRecorded backup/,
    );
  });

  it("rejects a backup missing its arrays", () => {
    expect(() =>
      parseBackup(JSON.stringify({ kind: "unrecorded-backup", version: 1 })),
    ).toThrow(/UnRecorded backup/);
  });
});

describe("planRestore", () => {
  it("inserts everything into an empty database and strips ids", () => {
    const b = backup([meeting(5, 1000), meeting(6, 2000)], [daily(9, "2026-07-24")]);
    const plan = planRestore(b, { startedAtMs: [], localDates: [] });

    expect(plan.meetingsToInsert).toHaveLength(2);
    expect(plan.dailyToInsert).toHaveLength(1);
    expect(plan.meetingsSkipped).toBe(0);
    // ids are stripped so autoincrement assigns fresh ones
    expect(plan.meetingsToInsert[0]).not.toHaveProperty("id");
    expect(plan.dailyToInsert[0]).not.toHaveProperty("id");
    // the action items (the thing we care about) survive intact
    expect((plan.meetingsToInsert[0].actionItems as unknown[])[0]).toMatchObject({
      task: "Do the thing",
    });
  });

  it("skips meetings that already exist (matched by start time)", () => {
    const b = backup([meeting(5, 1000), meeting(6, 2000)]);
    const plan = planRestore(b, { startedAtMs: [1000], localDates: [] });

    expect(plan.meetingsToInsert).toHaveLength(1);
    expect(plan.meetingsToInsert[0].startedAtMs).toBe(2000);
    expect(plan.meetingsSkipped).toBe(1);
  });

  it("skips daily summaries that already exist (matched by date)", () => {
    const b = backup([], [daily(1, "2026-07-24"), daily(2, "2026-07-25")]);
    const plan = planRestore(b, { startedAtMs: [], localDates: ["2026-07-24"] });

    expect(plan.dailyToInsert).toHaveLength(1);
    expect(plan.dailyToInsert[0].localDate).toBe("2026-07-25");
    expect(plan.dailySummariesSkipped).toBe(1);
  });

  it("is idempotent — re-importing the same file adds nothing", () => {
    const b = backup([meeting(5, 1000)], [daily(1, "2026-07-24")]);
    const plan = planRestore(b, {
      startedAtMs: [1000],
      localDates: ["2026-07-24"],
    });
    expect(plan.meetingsToInsert).toHaveLength(0);
    expect(plan.dailyToInsert).toHaveLength(0);
    expect(plan.meetingsSkipped).toBe(1);
    expect(plan.dailySummariesSkipped).toBe(1);
  });

  it("dedupes duplicates within the same backup file", () => {
    const b = backup([meeting(5, 1000), meeting(6, 1000)]);
    const plan = planRestore(b, { startedAtMs: [], localDates: [] });
    expect(plan.meetingsToInsert).toHaveLength(1);
    expect(plan.meetingsSkipped).toBe(1);
  });
});
