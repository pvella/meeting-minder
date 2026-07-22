export type SilenceBoundaryInput = {
  hasDetectedVoice: boolean;
  nowMs: number;
  meetingStartedAtMs: number | null;
  lastVoiceAtMs: number;
  minimumMeetingDurationMs: number;
  silenceThresholdMs: number;
};

export function shouldSplitForSilence(input: SilenceBoundaryInput) {
  if (!input.hasDetectedVoice || input.meetingStartedAtMs === null) return false;
  const meetingDurationMs = input.nowMs - input.meetingStartedAtMs;
  const silenceDurationMs = input.nowMs - input.lastVoiceAtMs;
  return (
    meetingDurationMs >= input.minimumMeetingDurationMs &&
    silenceDurationMs >= input.silenceThresholdMs
  );
}

export type VoiceActivityConfig = {
  /** RMS below this can never register as voice, however low the floor sits. */
  absoluteMinVoiceRms: number;
  /** Voice must exceed the tracked ambient noise floor by this factor. */
  noiseFloorFactor: number;
  /** The floor never adapts below this — real mics always self-noise a little. */
  noiseFloorMinRms: number;
  /** Where the floor starts before it has heard any audio. */
  noiseFloorInitialRms: number;
  /** Time constant for the floor drifting back up through non-voiced audio. */
  noiseFloorReleaseTauMs: number;
  /** A gap between frames longer than this means the analyser was suspended. */
  frameGapMs: number;
  /** Cumulative voiced time required before a silence split is allowed. */
  minVoicedMsForSplit: number;
};

/**
 * Tuned against a phone lying on a meeting-room table with WebRTC noise
 * suppression active (which crushes steady background noise to near zero).
 * The old detector used a fixed RMS threshold of 0.018, which quiet or
 * far-field speech routinely fails to reach — a 25-minute meeting once
 * fragmented into 25 pieces because conversation read as "silence".
 */
export const DEFAULT_VOICE_ACTIVITY_CONFIG: VoiceActivityConfig = {
  absoluteMinVoiceRms: 0.0045,
  noiseFloorFactor: 3.5,
  noiseFloorMinRms: 0.0008,
  noiseFloorInitialRms: 0.0015,
  noiseFloorReleaseTauMs: 15_000,
  frameGapMs: 1_500,
  minVoicedMsForSplit: 1_500,
};

/**
 * Adaptive voice-activity detector fed one RMS sample per animation frame.
 *
 * "Voice" is loudness relative to a tracked ambient noise floor rather than an
 * absolute level, so the detector calibrates itself to the room:
 *
 * - The floor follows quiet audio downward immediately (attack) and drifts
 *   upward only through non-voiced frames (release), so speech cannot drag the
 *   floor up under itself and then read as silence.
 * - A silence split is only offered once the meeting has accumulated a couple
 *   of seconds of real voiced time — one slammed door cannot arm the splitter.
 * - A long gap between frames means requestAnimationFrame was suspended
 *   (screen sleep, hidden app). That time was unobserved, not silent, so the
 *   silence clock restarts rather than splitting the instant the app returns.
 */
export class VoiceActivityDetector {
  private readonly config: VoiceActivityConfig;
  private noiseFloorRms: number;
  private voicedMs: number;
  private lastFrameAtMs: number;
  private lastVoiceAtMs: number;

  constructor(nowMs: number, config: VoiceActivityConfig = DEFAULT_VOICE_ACTIVITY_CONFIG) {
    this.config = config;
    this.noiseFloorRms = config.noiseFloorInitialRms;
    this.voicedMs = 0;
    this.lastFrameAtMs = nowMs;
    this.lastVoiceAtMs = nowMs;
  }

  /** Fresh meeting boundary: forget voiced time, keep the learned room floor. */
  reset(nowMs: number) {
    this.voicedMs = 0;
    this.lastFrameAtMs = nowMs;
    this.lastVoiceAtMs = nowMs;
  }

  get voiceThresholdRms(): number {
    return Math.max(
      this.config.absoluteMinVoiceRms,
      this.noiseFloorRms * this.config.noiseFloorFactor,
    );
  }

  /** Feed one RMS reading. Returns whether this frame counts as voice. */
  sample(rms: number, nowMs: number): boolean {
    const elapsedMs = Math.max(0, nowMs - this.lastFrameAtMs);
    this.lastFrameAtMs = nowMs;

    if (elapsedMs > this.config.frameGapMs) {
      this.lastVoiceAtMs = nowMs;
      return false;
    }

    const clamped = Math.max(rms, this.config.noiseFloorMinRms);
    if (clamped < this.noiseFloorRms) this.noiseFloorRms = clamped;

    const isVoice = rms >= this.voiceThresholdRms;
    if (isVoice) {
      this.voicedMs += elapsedMs;
      this.lastVoiceAtMs = nowMs;
    } else {
      this.noiseFloorRms +=
        (clamped - this.noiseFloorRms) *
        Math.min(1, elapsedMs / this.config.noiseFloorReleaseTauMs);
    }
    return isVoice;
  }

  shouldSplit(input: {
    nowMs: number;
    meetingStartedAtMs: number | null;
    minimumMeetingDurationMs: number;
    silenceThresholdMs: number;
  }): boolean {
    return shouldSplitForSilence({
      hasDetectedVoice: this.voicedMs >= this.config.minVoicedMsForSplit,
      nowMs: input.nowMs,
      meetingStartedAtMs: input.meetingStartedAtMs,
      lastVoiceAtMs: this.lastVoiceAtMs,
      minimumMeetingDurationMs: input.minimumMeetingDurationMs,
      silenceThresholdMs: input.silenceThresholdMs,
    });
  }
}
