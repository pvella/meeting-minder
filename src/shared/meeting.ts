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
