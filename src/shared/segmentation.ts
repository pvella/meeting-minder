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
