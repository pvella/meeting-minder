import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionItem, Decision, KeyTopic } from "@shared/meeting";
import { ClipboardCheck, Lightbulb, Plus, Save, Target, X } from "lucide-react";
import { useState } from "react";

export type SummaryDraft = {
  summaryOverview: string;
  keyTopics: KeyTopic[];
  decisions: Decision[];
  actionItems: ActionItem[];
};

type Props = {
  initial: SummaryDraft;
  isSaving: boolean;
  error?: string | null;
  onSave: (draft: SummaryDraft) => void;
  onCancel: () => void;
};

/** Replaces an item in a list without mutating the original. */
function replaceAt<T>(items: T[], index: number, next: T): T[] {
  return items.map((item, position) => (position === index ? next : item));
}

function SectionHeader({
  icon,
  title,
  onAdd,
}: {
  icon: React.ReactNode;
  title: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="icon-tile">{icon}</div>
        <h2 className="text-lg font-bold">{title}</h2>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onAdd}
        className="h-9 rounded-lg"
      >
        <Plus className="mr-1 h-4 w-4" /> Add
      </Button>
    </div>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={label}
      className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
    >
      <X className="h-4 w-4" />
    </Button>
  );
}

export function MeetingSummaryEditor({
  initial,
  isSaving,
  error,
  onSave,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState<SummaryDraft>(initial);

  const update = <K extends keyof SummaryDraft>(key: K, value: SummaryDraft[K]) =>
    setDraft(current => ({ ...current, [key]: value }));

  return (
    <form
      className="space-y-5"
      onSubmit={event => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="sticky top-14 z-30 -mx-1 flex items-center justify-end gap-2 bg-background/95 px-1 py-3 backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={isSaving}
          className="rounded-xl"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSaving || !draft.summaryOverview.trim()}
          className="rounded-xl"
        >
          <Save className="mr-2 h-4 w-4" />
          {isSaving ? "Saving…" : "Save summary"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
        <label htmlFor="summary-overview" className="text-lg font-bold">
          Overview
        </label>
        <Textarea
          id="summary-overview"
          value={draft.summaryOverview}
          onChange={event => update("summaryOverview", event.target.value)}
          rows={5}
          className="mt-4 rounded-xl text-base"
        />
      </Card>

      <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
        <SectionHeader
          icon={<Lightbulb className="h-4 w-4" />}
          title="Key topics"
          onAdd={() =>
            update("keyTopics", [...draft.keyTopics, { topic: "", details: "" }])
          }
        />
        <div className="mt-5 space-y-4">
          {draft.keyTopics.length ? (
            draft.keyTopics.map((item, index) => (
              <div key={index} className="rounded-xl bg-muted/40 p-3">
                <div className="flex items-start gap-2">
                  <Input
                    value={item.topic}
                    placeholder="Topic"
                    onChange={event =>
                      update(
                        "keyTopics",
                        replaceAt(draft.keyTopics, index, {
                          ...item,
                          topic: event.target.value,
                        }),
                      )
                    }
                    className="h-11 rounded-lg"
                  />
                  <RemoveButton
                    label={`Remove topic ${index + 1}`}
                    onClick={() =>
                      update(
                        "keyTopics",
                        draft.keyTopics.filter((_, position) => position !== index),
                      )
                    }
                  />
                </div>
                <Textarea
                  value={item.details}
                  placeholder="Details"
                  rows={2}
                  onChange={event =>
                    update(
                      "keyTopics",
                      replaceAt(draft.keyTopics, index, {
                        ...item,
                        details: event.target.value,
                      }),
                    )
                  }
                  className="mt-2 rounded-lg"
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No topics yet.</p>
          )}
        </div>
      </Card>

      <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
        <SectionHeader
          icon={<Target className="h-4 w-4" />}
          title="Decisions"
          onAdd={() =>
            update("decisions", [...draft.decisions, { decision: "", context: "" }])
          }
        />
        <div className="mt-5 space-y-4">
          {draft.decisions.length ? (
            draft.decisions.map((item, index) => (
              <div key={index} className="rounded-xl bg-muted/40 p-3">
                <div className="flex items-start gap-2">
                  <Input
                    value={item.decision}
                    placeholder="Decision"
                    onChange={event =>
                      update(
                        "decisions",
                        replaceAt(draft.decisions, index, {
                          ...item,
                          decision: event.target.value,
                        }),
                      )
                    }
                    className="h-11 rounded-lg"
                  />
                  <RemoveButton
                    label={`Remove decision ${index + 1}`}
                    onClick={() =>
                      update(
                        "decisions",
                        draft.decisions.filter((_, position) => position !== index),
                      )
                    }
                  />
                </div>
                <Textarea
                  value={item.context}
                  placeholder="Context"
                  rows={2}
                  onChange={event =>
                    update(
                      "decisions",
                      replaceAt(draft.decisions, index, {
                        ...item,
                        context: event.target.value,
                      }),
                    )
                  }
                  className="mt-2 rounded-lg"
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No decisions yet.</p>
          )}
        </div>
      </Card>

      <Card className="rounded-[1.5rem] border-0 p-6 shadow-sm ring-1 ring-border/60">
        <SectionHeader
          icon={<ClipboardCheck className="h-4 w-4" />}
          title="Action items"
          onAdd={() =>
            update("actionItems", [
              ...draft.actionItems,
              { task: "", owner: "Unassigned", dueDate: "Not specified" },
            ])
          }
        />
        <div className="mt-5 space-y-4">
          {draft.actionItems.length ? (
            draft.actionItems.map((item, index) => (
              <div key={index} className="rounded-xl bg-muted/40 p-3">
                <div className="flex items-start gap-2">
                  <Input
                    value={item.task}
                    placeholder="Task"
                    onChange={event =>
                      update(
                        "actionItems",
                        replaceAt(draft.actionItems, index, {
                          ...item,
                          task: event.target.value,
                        }),
                      )
                    }
                    className="h-11 rounded-lg"
                  />
                  <RemoveButton
                    label={`Remove action item ${index + 1}`}
                    onClick={() =>
                      update(
                        "actionItems",
                        draft.actionItems.filter((_, position) => position !== index),
                      )
                    }
                  />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Input
                    value={item.owner}
                    placeholder="Owner"
                    onChange={event =>
                      update(
                        "actionItems",
                        replaceAt(draft.actionItems, index, {
                          ...item,
                          owner: event.target.value,
                        }),
                      )
                    }
                    className="h-11 rounded-lg"
                  />
                  <Input
                    value={item.dueDate}
                    placeholder="Due date"
                    onChange={event =>
                      update(
                        "actionItems",
                        replaceAt(draft.actionItems, index, {
                          ...item,
                          dueDate: event.target.value,
                        }),
                      )
                    }
                    className="h-11 rounded-lg"
                  />
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No action items yet.</p>
          )}
        </div>
      </Card>
    </form>
  );
}
