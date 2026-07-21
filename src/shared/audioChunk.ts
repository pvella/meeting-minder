export const MIN_TRANSCRIBABLE_AUDIO_BYTES = 1_024;

export type AudioChunkState = {
  sequence: number;
  transcriptionStatus: string;
  errorMessage: string | null;
  sizeBytes: number;
  durationMs: number;
};

export function isIgnorableTerminalAudioFragment(
  chunk: AudioChunkState,
  allChunks: AudioChunkState[],
) {
  const lastSequence = Math.max(...allChunks.map(item => item.sequence));
  const decodeFailure = /decode|format|not supported|empty audio/i.test(
    chunk.errorMessage ?? "",
  );

  return (
    chunk.transcriptionStatus === "failed" &&
    chunk.sequence === lastSequence &&
    chunk.sizeBytes < MIN_TRANSCRIBABLE_AUDIO_BYTES &&
    chunk.durationMs <= 3_000 &&
    decodeFailure &&
    allChunks.some(item => item.transcriptionStatus === "completed")
  );
}

export function getBlockingAudioChunks(allChunks: AudioChunkState[]) {
  return allChunks.filter(
    chunk =>
      chunk.transcriptionStatus !== "completed" &&
      !isIgnorableTerminalAudioFragment(chunk, allChunks),
  );
}
