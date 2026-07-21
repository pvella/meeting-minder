import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import * as meetings from "@/services/meetings";

/**
 * TanStack Query bindings over the local service layer. These replace the tRPC
 * hooks the Manus build used; the service calls are in-process, so there is no
 * network client here — React Query is retained purely for caching and
 * invalidation.
 */

export const queryKeys = {
  meetings: ["meetings"] as const,
  meeting: (meetingId: number) => ["meetings", meetingId] as const,
  dailySummaries: ["dailySummaries"] as const,
  dailySummary: (localDate: string) => ["dailySummaries", localDate] as const,
};

export function useMeetings(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: queryKeys.meetings,
    queryFn: () => meetings.listMeetings(),
    refetchInterval: options?.refetchInterval ?? false,
  });
}

type MeetingDetail = Awaited<ReturnType<typeof meetings.getMeetingDetail>>;

export function useMeetingDetail(
  meetingId: number,
  options?: Pick<
    UseQueryOptions<MeetingDetail>,
    "enabled" | "refetchInterval"
  >,
) {
  return useQuery({
    queryKey: queryKeys.meeting(meetingId),
    queryFn: () => meetings.getMeetingDetail(meetingId),
    ...options,
  });
}

export function useDailySummaries() {
  return useQuery({
    queryKey: queryKeys.dailySummaries,
    queryFn: () => meetings.listDailySummaries(),
  });
}

export function useDailySummary(localDate: string) {
  return useQuery({
    queryKey: queryKeys.dailySummary(localDate),
    queryFn: () => meetings.getDailySummaryDetail(localDate),
    enabled: Boolean(localDate),
  });
}

/**
 * Summaries change meeting rows, the meeting list, and the affected day's
 * roll-up all at once, so mutations invalidate the lot rather than trying to
 * reason about which view is currently mounted.
 */
export function useInvalidateMeetingViews() {
  const queryClient = useQueryClient();
  return async (meetingId?: number) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.meetings }),
      queryClient.invalidateQueries({ queryKey: queryKeys.dailySummaries }),
      ...(meetingId
        ? [queryClient.invalidateQueries({ queryKey: queryKeys.meeting(meetingId) })]
        : []),
    ]);
  };
}

export function useRenameMeeting() {
  const invalidate = useInvalidateMeetingViews();
  return useMutation({
    mutationFn: (input: { meetingId: number; title: string }) =>
      meetings.renameMeeting(input),
    onSuccess: (_result, variables) => invalidate(variables.meetingId),
  });
}

export function useSummarizeMeeting() {
  const invalidate = useInvalidateMeetingViews();
  return useMutation({
    mutationFn: (input: Parameters<typeof meetings.summarizeMeeting>[0]) =>
      meetings.summarizeMeeting(input),
    onSuccess: (_result, variables) => invalidate(variables.meetingId),
  });
}

export function useCreateMeeting() {
  return useMutation({
    mutationFn: (input: { startedAtMs: number }) => meetings.createMeeting(input),
  });
}

export function useTranscribeChunk() {
  return useMutation({
    mutationFn: (input: Parameters<typeof meetings.transcribeChunk>[0]) =>
      meetings.transcribeChunk(input),
  });
}

export function useSplitMeeting() {
  return useMutation({
    mutationFn: (input: Parameters<typeof meetings.splitMeeting>[0]) =>
      meetings.splitMeeting(input),
  });
}

export function useFinalizeMeeting() {
  return useMutation({
    mutationFn: (input: { meetingId: number; endedAtMs: number }) =>
      meetings.finalizeMeeting(input),
  });
}
