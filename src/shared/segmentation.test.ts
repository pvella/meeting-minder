import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_ACTIVITY_CONFIG,
  VoiceActivityDetector,
  shouldSplitForSilence,
} from "./segmentation";

const FRAME_MS = 50;
const SPLIT_PARAMS = {
  minimumMeetingDurationMs: 15_000,
  silenceThresholdMs: 12_000,
};

/** Feed constant-RMS frames for a duration; returns first nowMs a split fired. */
function run(
  detector: VoiceActivityDetector,
  opts: {
    rms: number;
    fromMs: number;
    durationMs: number;
    meetingStartedAtMs: number;
  },
): { splitAtMs: number | null; endMs: number } {
  let splitAtMs: number | null = null;
  const endMs = opts.fromMs + opts.durationMs;
  for (let now = opts.fromMs + FRAME_MS; now <= endMs; now += FRAME_MS) {
    detector.sample(opts.rms, now);
    if (
      splitAtMs === null &&
      detector.shouldSplit({
        nowMs: now,
        meetingStartedAtMs: opts.meetingStartedAtMs,
        ...SPLIT_PARAMS,
      })
    ) {
      splitAtMs = now;
    }
  }
  return { splitAtMs, endMs };
}

const QUIET_ROOM_RMS = 0.0012; // suppressed ambient, below the floor's minimum band
const QUIET_SPEECH_RMS = 0.008; // audible speech that the old 0.018 bar missed

describe("shouldSplitForSilence", () => {
  const base = {
    hasDetectedVoice: true,
    nowMs: 60_000,
    meetingStartedAtMs: 0,
    lastVoiceAtMs: 40_000,
    ...SPLIT_PARAMS,
  };

  it("splits after sustained silence in a mature meeting", () => {
    expect(shouldSplitForSilence(base)).toBe(true);
  });

  it("never splits before voice has been detected", () => {
    expect(shouldSplitForSilence({ ...base, hasDetectedVoice: false })).toBe(false);
  });

  it("never splits a meeting younger than the minimum duration", () => {
    expect(
      shouldSplitForSilence({ ...base, meetingStartedAtMs: 50_000, lastVoiceAtMs: 46_000 }),
    ).toBe(false);
  });

  it("does not split while silence is shorter than the threshold", () => {
    expect(shouldSplitForSilence({ ...base, lastVoiceAtMs: 50_000 })).toBe(false);
  });
});

describe("VoiceActivityDetector", () => {
  it("counts quiet speech as voice — the fixed 0.018 threshold regression", () => {
    // 22-07-2026: a 25-minute meeting fragmented into 25 pieces because
    // conversational speech never crossed the fixed RMS bar. The same level
    // must keep a meeting alive indefinitely under the adaptive detector.
    const detector = new VoiceActivityDetector(0);
    const { splitAtMs } = run(detector, {
      rms: QUIET_SPEECH_RMS,
      fromMs: 0,
      durationMs: 25 * 60_000,
      meetingStartedAtMs: 0,
    });
    expect(splitAtMs).toBeNull();
  });

  it("splits once genuine room silence outlasts the threshold", () => {
    const detector = new VoiceActivityDetector(0);
    const speech = run(detector, {
      rms: QUIET_SPEECH_RMS,
      fromMs: 0,
      durationMs: 20_000,
      meetingStartedAtMs: 0,
    });
    const silence = run(detector, {
      rms: QUIET_ROOM_RMS,
      fromMs: speech.endMs,
      durationMs: 20_000,
      meetingStartedAtMs: 0,
    });
    expect(silence.splitAtMs).not.toBeNull();
    // Split lands at ~12s of silence, give or take a frame.
    expect(silence.splitAtMs! - speech.endMs).toBeGreaterThanOrEqual(
      SPLIT_PARAMS.silenceThresholdMs,
    );
    expect(silence.splitAtMs! - speech.endMs).toBeLessThan(
      SPLIT_PARAMS.silenceThresholdMs + 1_000,
    );
  });

  it("a brief noise blip does not arm the silence splitter", () => {
    const detector = new VoiceActivityDetector(0);
    // One 200ms door slam, then a silent room forever.
    run(detector, { rms: 0.2, fromMs: 0, durationMs: 200, meetingStartedAtMs: 0 });
    const silence = run(detector, {
      rms: QUIET_ROOM_RMS,
      fromMs: 200,
      durationMs: 60_000,
      meetingStartedAtMs: 0,
    });
    expect(silence.splitAtMs).toBeNull();
  });

  it("does not treat an analyser suspension as silence", () => {
    const detector = new VoiceActivityDetector(0);
    const speech = run(detector, {
      rms: QUIET_SPEECH_RMS,
      fromMs: 0,
      durationMs: 20_000,
      meetingStartedAtMs: 0,
    });
    // Screen slept for 30s (no frames), then the app came back to a quiet room.
    const resumeAtMs = speech.endMs + 30_000;
    detector.sample(QUIET_ROOM_RMS, resumeAtMs);
    expect(
      detector.shouldSplit({ nowMs: resumeAtMs, meetingStartedAtMs: 0, ...SPLIT_PARAMS }),
    ).toBe(false);
    // A full observed silence window must elapse after resume before a split.
    const silence = run(detector, {
      rms: QUIET_ROOM_RMS,
      fromMs: resumeAtMs,
      durationMs: 20_000,
      meetingStartedAtMs: 0,
    });
    expect(silence.splitAtMs! - resumeAtMs).toBeGreaterThanOrEqual(
      SPLIT_PARAMS.silenceThresholdMs,
    );
  });

  it("adapts the voice bar to a noisier room", () => {
    const detector = new VoiceActivityDetector(0);
    // A minute of steady 0.002 hum should lift the floor toward the hum...
    run(detector, { rms: 0.002, fromMs: 0, durationMs: 60_000, meetingStartedAtMs: 0 });
    expect(detector.voiceThresholdRms).toBeGreaterThan(
      DEFAULT_VOICE_ACTIVITY_CONFIG.absoluteMinVoiceRms,
    );
    // ...but speech well above the hum still registers.
    expect(detector.sample(QUIET_SPEECH_RMS, 60_050)).toBe(true);
  });

  it("reset clears meeting-scoped clocks but keeps the learned floor", () => {
    const detector = new VoiceActivityDetector(0);
    run(detector, { rms: 0.002, fromMs: 0, durationMs: 60_000, meetingStartedAtMs: 0 });
    const learnedThreshold = detector.voiceThresholdRms;
    detector.reset(60_000);
    expect(detector.voiceThresholdRms).toBe(learnedThreshold);
    // Voiced time was cleared, so silence alone can no longer split.
    const silence = run(detector, {
      rms: QUIET_ROOM_RMS,
      fromMs: 60_000,
      durationMs: 60_000,
      meetingStartedAtMs: 60_000,
    });
    expect(silence.splitAtMs).toBeNull();
  });
});
