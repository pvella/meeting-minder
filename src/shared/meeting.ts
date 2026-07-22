export type KeyTopic = {
  topic: string;
  details: string;
};

export type Decision = {
  decision: string;
  context: string;
};

export type ActionItem = {
  task: string;
  owner: string;
  dueDate: string;
  /** Short thematic label assigned at summary time; older items may lack one. */
  topic?: string;
  /** Set when the user ticks the item off; null/absent while it is open. */
  completedAtMs?: number | null;
};

export type MeetingSummary = {
  suggestedTitle: string;
  overview: string;
  keyTopics: KeyTopic[];
  decisions: Decision[];
  actionItems: ActionItem[];
};

export type DailyActionItem = {
  meetingId: number;
  task: string;
  owner: string;
  dueDate: string;
};

export type DailySummaryContent = {
  overview: string;
  highlights: string[];
  actionItems: DailyActionItem[];
};

export type LocalDay = {
  localDate: string;
  timezone: string;
  dayStartAtMs: number;
  dayEndAtMs: number;
};

export type TranscriptDraft = {
  sequence: number;
  startMs: number;
  endMs: number;
  text: string;
};
