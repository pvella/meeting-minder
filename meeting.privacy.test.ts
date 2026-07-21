import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const getMeetingDetailForUser = vi.fn();

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return { ...actual, getMeetingDetailForUser };
});

const { appRouter } = await import("./routers");

function contextFor(userId: number | null): TrpcContext {
  return {
    user: userId
      ? {
          id: userId,
          openId: `user-${userId}`,
          email: `user${userId}@example.com`,
          name: `User ${userId}`,
          loginMethod: "manus",
          role: "user",
          createdAt: new Date(),
          updatedAt: new Date(),
          lastSignedIn: new Date(),
        }
      : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("private meeting access", () => {
  beforeEach(() => getMeetingDetailForUser.mockReset());

  it("requires authentication", async () => {
    const caller = appRouter.createCaller(contextFor(null));
    await expect(caller.meeting.detail({ meetingId: 8 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("always scopes meeting detail lookup to the authenticated user", async () => {
    getMeetingDetailForUser.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(contextFor(42));
    await expect(caller.meeting.detail({ meetingId: 8 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(getMeetingDetailForUser).toHaveBeenCalledWith(8, 42);
  });
});
