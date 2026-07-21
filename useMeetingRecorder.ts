import { trpc } from "@/lib/trpc";
import { shouldSplitForSilence } from "@shared/segmentation";
import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "splitting"
  | "stopping"
  | "error";

type SplitReason = "manual" | "silence";

type ChunkPayload = {
  meetingId: number;
  sequence: number;
  audioBase64: string;
  mimeType: string;
  chunkStartedAtMs: number;
  chunkEndedAtMs: number;
  chunkOffsetMs: number;
};

type LiveTranscriptSegment = {
  id: number;
  meetingId: number;
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
};

function getLocalDay(timestampMs: number) {
  const date = new Date(timestampMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const dayStart = new Date(year, date.getMonth(), date.getDate());
  const dayEnd = new Date(year, date.getMonth(), date.getDate() + 1);
  return {
    localDate: `${year}-${month}-${day}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    dayStartAtMs: dayStart.getTime(),
    dayEndAtMs: dayEnd.getTime(),
  };
}

const CHUNK_INTERVAL_MS = 10_000;
const MIN_MEETING_DURATION_MS = 15_000;
const VOICE_RMS_THRESHOLD = 0.018;

function chooseMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate));
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const batchSize = 32_768;
  for (let index = 0; index < bytes.length; index += batchSize) {
    const batch = bytes.subarray(index, index + batchSize);
    const values = Array.from(batch);
    binary += String.fromCharCode(...values);
  }
  return window.btoa(binary);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "An audio operation failed.";
}

function isTransportError(message: string) {
  return /network|fetch|offline|connection|timeout|gateway/i.test(message);
}

export function useMeetingRecorder() {
  const utils = trpc.useUtils();
  const createMeeting = trpc.meeting.create.useMutation();
  const transcribeChunk = trpc.meeting.transcribeChunk.useMutation();
  const splitMeeting = trpc.meeting.split.useMutation();
  const finalizeMeeting = trpc.meeting.finalize.useMutation();
  const summarizeMeeting = trpc.meeting.summarize.useMutation();

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [activeMeetingId, setActiveMeetingId] = useState<number | null>(null);
  const [meetingStartedAtMs, setMeetingStartedAtMs] = useState<number | null>(null);
  const [clockMs, setClockMs] = useState(Date.now());
  const [audioLevel, setAudioLevel] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscriptSegment[]>([]);
  const [pendingChunks, setPendingChunks] = useState(0);
  const [capturedChunkCount, setCapturedChunkCount] = useState(0);
  const [transcribedChunkCount, setTranscribedChunkCount] = useState(0);
  const [uploadingChunks, setUploadingChunks] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [failedChunkCount, setFailedChunkCount] = useState(0);
  const [silenceThresholdSeconds, setSilenceThresholdSeconds] = useState(12);
  const [lastSplitReason, setLastSplitReason] = useState<SplitReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderCycleRef = useRef(0);
  const recorderTimerRef = useRef<number | null>(null);
  const recorderStopPromiseRef = useRef<{
    recorder: MediaRecorder;
    promise: Promise<void>;
  } | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const activeMeetingIdRef = useRef<number | null>(null);
  const meetingStartedAtRef = useRef<number | null>(null);
  const sequenceByMeetingRef = useRef(new Map<number, number>());
  const pendingByMeetingRef = useRef(new Map<number, Set<Promise<void>>>());
  const failedChunksRef = useRef(new Map<string, ChunkPayload>());
  const pendingSummaryByMeetingRef = useRef(new Map<number, number>());
  const splitLockRef = useRef(false);
  const hasDetectedVoiceRef = useRef(false);
  const lastVoiceAtRef = useRef(Date.now());
  const lastLevelPaintAtRef = useRef(0);
  const silenceThresholdSecondsRef = useRef(silenceThresholdSeconds);
  const performSplitRef = useRef<(reason: SplitReason) => Promise<void>>(
    async () => undefined,
  );

  const refreshMeetings = useCallback(async () => {
    await utils.meeting.list.invalidate();
  }, [utils]);

  const addPending = useCallback((meetingId: number, promise: Promise<void>) => {
    const existing = pendingByMeetingRef.current.get(meetingId) ?? new Set();
    existing.add(promise);
    pendingByMeetingRef.current.set(meetingId, existing);
    setPendingChunks(count => count + 1);
    void promise.finally(() => {
      existing.delete(promise);
      if (existing.size === 0) pendingByMeetingRef.current.delete(meetingId);
      setPendingChunks(count => Math.max(0, count - 1));
    });
  }, []);

  const submitChunk = useCallback(
    async (payload: ChunkPayload) => {
      const failureKey = `${payload.meetingId}:${payload.sequence}`;
      try {
        const result = await transcribeChunk.mutateAsync(payload);
        if (!result.reused) {
          setTranscribedChunkCount(count => count + 1);
        }
        failedChunksRef.current.delete(failureKey);
        setFailedChunkCount(failedChunksRef.current.size);
        if (activeMeetingIdRef.current === payload.meetingId) {
          setLiveTranscript(current => {
            const byId = new Map(current.map(segment => [segment.id, segment]));
            result.segments.forEach(segment => byId.set(segment.id, segment));
            return Array.from(byId.values()).sort(
              (left, right) => left.sequence - right.sequence,
            );
          });
        }
      } catch (chunkError) {
        failedChunksRef.current.set(failureKey, payload);
        setFailedChunkCount(failedChunksRef.current.size);
        const message = getErrorMessage(chunkError);
        if (isTransportError(message)) {
          setUploadError("The audio section could not reach the server. It will remain available to retry.");
        } else {
          setTranscriptionError(message);
        }
        setError(message);
        throw chunkError;
      }
    },
    [transcribeChunk],
  );

  const queueBlob = useCallback(
    async (
      blob: Blob,
      meetingId: number,
      meetingStartMs: number,
      chunkStartMs: number,
      chunkEndMs: number,
      mimeType: string,
    ) => {
      if (blob.size === 0) return;
      const sequence = sequenceByMeetingRef.current.get(meetingId) ?? 0;
      sequenceByMeetingRef.current.set(meetingId, sequence + 1);
      setCapturedChunkCount(count => count + 1);
      setUploadingChunks(count => count + 1);
      try {
        const audioBase64 = await blobToBase64(blob);
        const payload: ChunkPayload = {
          meetingId,
          sequence,
          audioBase64,
          mimeType,
          chunkStartedAtMs: chunkStartMs,
          chunkEndedAtMs: chunkEndMs,
          chunkOffsetMs: Math.max(0, chunkStartMs - meetingStartMs),
        };
        await submitChunk(payload);
      } finally {
        setUploadingChunks(count => Math.max(0, count - 1));
      }
    },
    [submitChunk],
  );

  const stopRecorderInstance = useCallback((recorder: MediaRecorder) => {
    const activeStop = recorderStopPromiseRef.current;
    if (activeStop?.recorder === recorder) return activeStop.promise;
    if (recorder.state === "inactive") return Promise.resolve();

    const promise = new Promise<void>(resolve => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.stop();
    });
    recorderStopPromiseRef.current = { recorder, promise };
    void promise.finally(() => {
      if (recorderStopPromiseRef.current?.recorder === recorder) {
        recorderStopPromiseRef.current = null;
      }
    });
    return promise;
  }, []);

  const startMediaRecorder = useCallback(
    (stream: MediaStream, meetingId: number, meetingStartMs: number) => {
      const mimeType = chooseMimeType();
      const cycle = recorderCycleRef.current + 1;
      recorderCycleRef.current = cycle;

      const beginStandaloneChunk = () => {
        if (
          recorderCycleRef.current !== cycle ||
          !stream.active ||
          activeMeetingIdRef.current !== meetingId
        ) {
          return;
        }

        const recorder = mimeType
          ? new MediaRecorder(stream, {
              mimeType,
              audioBitsPerSecond: 48_000,
            })
          : new MediaRecorder(stream);
        const chunkStartMs = Date.now();

        recorder.ondataavailable = event => {
          const chunkEndMs = Date.now();
          const pending = queueBlob(
            event.data,
            meetingId,
            meetingStartMs,
            chunkStartMs,
            chunkEndMs,
            recorder.mimeType || event.data.type || "audio/webm",
          ).catch(() => undefined);
          addPending(meetingId, pending);
        };
        recorderRef.current = recorder;
        recorder.start();
        recorderTimerRef.current = window.setTimeout(() => {
          recorderTimerRef.current = null;
          void stopRecorderInstance(recorder).then(() => {
            if (recorderRef.current === recorder) recorderRef.current = null;
            if (
              recorderCycleRef.current === cycle &&
              activeMeetingIdRef.current === meetingId &&
              stream.active
            ) {
              beginStandaloneChunk();
            }
          });
        }, CHUNK_INTERVAL_MS);
      };

      beginStandaloneChunk();
    },
    [addPending, queueBlob, stopRecorderInstance],
  );

  const stopMediaRecorder = useCallback(async () => {
    recorderCycleRef.current += 1;
    if (recorderTimerRef.current !== null) {
      window.clearTimeout(recorderTimerRef.current);
      recorderTimerRef.current = null;
    }
    const recorder = recorderRef.current;
    if (!recorder) return;
    await stopRecorderInstance(recorder);
    if (recorderRef.current === recorder) recorderRef.current = null;
  }, [stopRecorderInstance]);

  const waitForPendingMeetingChunks = useCallback(async (meetingId: number) => {
    while (true) {
      const pending = pendingByMeetingRef.current.get(meetingId);
      if (!pending || pending.size === 0) return;
      await Promise.allSettled(Array.from(pending));
    }
  }, []);

  const summarizeAfterUploads = useCallback(
    async (meetingId: number, startedAtMs: number) => {
      await waitForPendingMeetingChunks(meetingId);
      const hasFailedChunks = Array.from(failedChunksRef.current.values()).some(
        payload => payload.meetingId === meetingId,
      );
      if (hasFailedChunks) pendingSummaryByMeetingRef.current.set(meetingId, startedAtMs);
      try {
        await summarizeMeeting.mutateAsync({
          meetingId,
          ...getLocalDay(startedAtMs),
        });
        pendingSummaryByMeetingRef.current.delete(meetingId);
        await utils.dailySummary.list.invalidate();
      } catch (summaryError) {
        if (hasFailedChunks) {
          pendingSummaryByMeetingRef.current.set(meetingId, startedAtMs);
        }
        throw summaryError;
      } finally {
        await refreshMeetings();
        await utils.meeting.detail.invalidate({ meetingId });
      }
    },
    [refreshMeetings, summarizeMeeting, utils, waitForPendingMeetingChunks],
  );

  const stopAudioAnalysis = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close();
    }
    setAudioLevel(0);
  }, []);

  const startAudioAnalysis = useCallback(
    (stream: MediaStream) => {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.78;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      const samples = new Float32Array(analyser.fftSize);

      const analyse = () => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) {
          const sample = samples[index] ?? 0;
          sum += sample * sample;
        }
        const rms = Math.sqrt(sum / samples.length);
        const now = Date.now();
        if (now - lastLevelPaintAtRef.current > 80) {
          setAudioLevel(Math.min(1, rms * 7));
          lastLevelPaintAtRef.current = now;
        }
        if (rms >= VOICE_RMS_THRESHOLD) {
          hasDetectedVoiceRef.current = true;
          lastVoiceAtRef.current = now;
        } else {
          if (
            shouldSplitForSilence({
              hasDetectedVoice: hasDetectedVoiceRef.current,
              nowMs: now,
              meetingStartedAtMs: meetingStartedAtRef.current,
              lastVoiceAtMs: lastVoiceAtRef.current,
              minimumMeetingDurationMs: MIN_MEETING_DURATION_MS,
              silenceThresholdMs: silenceThresholdSecondsRef.current * 1000,
            }) &&
            !splitLockRef.current
          ) {
            void performSplitRef.current("silence");
          }
        }
        animationFrameRef.current = requestAnimationFrame(analyse);
      };
      analyse();
    },
    [],
  );

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus("error");
      setError(
        "This browser does not support secure microphone recording. Use a current version of Chrome, Edge, or Safari over HTTPS.",
      );
      return;
    }

    setError(null);
    setStatus("requesting");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const startedAtMs = Date.now();
      const meeting = await createMeeting.mutateAsync({ startedAtMs });
      if (!meeting) throw new Error("The meeting could not be created");
      streamRef.current = stream;
      activeMeetingIdRef.current = meeting.id;
      meetingStartedAtRef.current = startedAtMs;
      sequenceByMeetingRef.current.set(meeting.id, 0);
      hasDetectedVoiceRef.current = false;
      lastVoiceAtRef.current = startedAtMs;
      setActiveMeetingId(meeting.id);
      setMeetingStartedAtMs(startedAtMs);
      setLiveTranscript([]);
      setCapturedChunkCount(0);
      setTranscribedChunkCount(0);
      setUploadingChunks(0);
      setUploadError(null);
      setTranscriptionError(null);
      setLastSplitReason(null);
      startMediaRecorder(stream, meeting.id, startedAtMs);
      startAudioAnalysis(stream);
      setStatus("recording");
      await refreshMeetings();
    } catch (startError) {
      stream?.getTracks().forEach(track => track.stop());
      setStatus("error");
      setError(
        startError instanceof Error
          ? startError.message
          : "Microphone access could not be started.",
      );
    }
  }, [createMeeting, refreshMeetings, startAudioAnalysis, startMediaRecorder]);

  const performSplit = useCallback(
    async (reason: SplitReason) => {
      const meetingId = activeMeetingIdRef.current;
      const previousStartedAtMs = meetingStartedAtRef.current;
      const stream = streamRef.current;
      if (
        !meetingId ||
        !previousStartedAtMs ||
        !stream ||
        splitLockRef.current ||
        status !== "recording"
      ) {
        return;
      }

      splitLockRef.current = true;
      setStatus("splitting");
      setError(null);
      try {
        const boundaryAtMs = Date.now();
        await stopMediaRecorder();
        const nextMeeting = await splitMeeting.mutateAsync({
          meetingId,
          endedAtMs: boundaryAtMs,
          nextStartedAtMs: boundaryAtMs,
        });
        activeMeetingIdRef.current = nextMeeting.id;
        meetingStartedAtRef.current = boundaryAtMs;
        sequenceByMeetingRef.current.set(nextMeeting.id, 0);
        hasDetectedVoiceRef.current = false;
        lastVoiceAtRef.current = boundaryAtMs;
        setActiveMeetingId(nextMeeting.id);
        setMeetingStartedAtMs(boundaryAtMs);
        setLiveTranscript([]);
        setCapturedChunkCount(0);
        setTranscribedChunkCount(0);
        setUploadingChunks(0);
        setUploadError(null);
        setTranscriptionError(null);
        setLastSplitReason(reason);
        startMediaRecorder(stream, nextMeeting.id, boundaryAtMs);
        setStatus("recording");
        await refreshMeetings();
        void summarizeAfterUploads(meetingId, previousStartedAtMs).catch(summaryError => {
          setError(
            summaryError instanceof Error
              ? summaryError.message
              : "The previous meeting summary could not be generated.",
          );
        });
      } catch (splitError) {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        stopAudioAnalysis();
        setStatus("error");
        setError(
          splitError instanceof Error
            ? splitError.message
            : "The meeting could not be split.",
        );
      } finally {
        splitLockRef.current = false;
      }
    },
    [
      refreshMeetings,
      splitMeeting,
      startMediaRecorder,
      status,
      stopMediaRecorder,
      stopAudioAnalysis,
      summarizeAfterUploads,
    ],
  );

  performSplitRef.current = performSplit;

  const stopRecording = useCallback(async () => {
    const meetingId = activeMeetingIdRef.current;
    const startedAtMs = meetingStartedAtRef.current;
    if (!meetingId || !startedAtMs || status === "stopping") return;
    setStatus("stopping");
    setError(null);
    const endedAtMs = Date.now();
    try {
      stopAudioAnalysis();
      await stopMediaRecorder();
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      await finalizeMeeting.mutateAsync({ meetingId, endedAtMs });
      await summarizeAfterUploads(meetingId, startedAtMs);
      activeMeetingIdRef.current = null;
      meetingStartedAtRef.current = null;
      setActiveMeetingId(null);
      setMeetingStartedAtMs(null);
      setStatus("idle");
    } catch (stopError) {
      streamRef.current?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      setStatus("error");
      setError(
        stopError instanceof Error
          ? stopError.message
          : "The recording could not be finalized.",
      );
    }
  }, [finalizeMeeting, status, stopAudioAnalysis, stopMediaRecorder, summarizeAfterUploads]);

  const retryFailedChunks = useCallback(async () => {
    setError(null);
    const failed = Array.from(failedChunksRef.current.values());
    await Promise.allSettled(
      failed.map(payload => {
        const pending = submitChunk(payload).catch(() => undefined);
        addPending(payload.meetingId, pending);
        return pending;
      }),
    );
    const readyToSummarize = Array.from(
      pendingSummaryByMeetingRef.current.entries(),
    ).filter(([meetingId]) =>
      Array.from(failedChunksRef.current.values()).every(
        payload => payload.meetingId !== meetingId,
      ),
    );
    await Promise.allSettled(
      readyToSummarize.map(([meetingId, startedAtMs]) =>
        summarizeAfterUploads(meetingId, startedAtMs),
      ),
    );
    if (!streamRef.current && failedChunksRef.current.size === 0) {
      activeMeetingIdRef.current = null;
      meetingStartedAtRef.current = null;
      setActiveMeetingId(null);
      setMeetingStartedAtMs(null);
      setStatus("idle");
    }
  }, [addPending, submitChunk, summarizeAfterUploads]);

  const clearError = useCallback(() => {
    setError(null);
    if (status === "error" && !streamRef.current) setStatus("idle");
  }, [status]);

  useEffect(() => {
    if (status !== "recording" && status !== "splitting") return;
    const timer = window.setInterval(() => setClockMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [status]);

  useEffect(() => {
    silenceThresholdSecondsRef.current = silenceThresholdSeconds;
  }, [silenceThresholdSeconds]);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      recorderCycleRef.current += 1;
      if (recorderTimerRef.current !== null) {
        window.clearTimeout(recorderTimerRef.current);
      }
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      if (audioContextRef.current?.state !== "closed") {
        void audioContextRef.current?.close();
      }
    },
    [],
  );

  return {
    status,
    isRecording: status === "recording" || status === "splitting",
    activeMeetingId,
    meetingStartedAtMs,
    elapsedMs: meetingStartedAtMs ? Math.max(0, clockMs - meetingStartedAtMs) : 0,
    audioLevel,
    liveTranscript,
    pendingChunks,
    capturedChunkCount,
    transcribedChunkCount,
    uploadingChunks,
    uploadError,
    transcriptionError,
    failedChunkCount,
    silenceThresholdSeconds,
    setSilenceThresholdSeconds,
    lastSplitReason,
    error,
    startRecording,
    stopRecording,
    splitMeeting: () => performSplit("manual"),
    retryFailedChunks,
    clearError,
  };
}
