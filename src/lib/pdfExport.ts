import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { jsPDF } from "jspdf";
import { formatDuration, longDate, timeOfDay } from "@/lib/dates";
import type {
  ActionItem,
  DailyActionItem,
  Decision,
  KeyTopic,
} from "@shared/meeting";

/**
 * Client-side PDF export for a single meeting summary or a daily roll-up.
 *
 * There is no server, so the PDF is built in the WebView with jsPDF. Delivery
 * differs by platform: on Android (native) the file is written to the cache
 * directory and handed to the OS share sheet, so the user can save it to Files,
 * Drive, print, or send it on. In a browser it falls back to a normal download.
 *
 * The layout is deliberately plain black-on-white body text with a green
 * heading band — it reads and prints far better than trying to mirror the app's
 * dark gradient hero cards.
 */

// jsPDF works in points. A4 with a comfortable margin.
const MARGIN = 48;
const BRAND: [number, number, number] = [21, 88, 67]; // ~ primary dark green
const MUTED: [number, number, number] = [110, 110, 110];
const INK: [number, number, number] = [30, 30, 30];

/** Structural inputs — kept loose so callers can pass the query rows directly. */
export type MeetingPdfInput = {
  title: string;
  startedAtMs: number;
  durationMs: number;
  summaryOverview: string | null;
  keyTopics: KeyTopic[] | null;
  decisions: Decision[] | null;
  actionItems: ActionItem[] | null;
  summaryGeneratedAtMs: number | null;
};

export type DailyPdfInput = {
  localDate: string;
  overview: string;
  highlights: string[];
  actionItems: DailyActionItem[];
  generatedAtMs: number | null;
};

/** A tiny cursor-based layout helper over jsPDF so pagination stays in one place. */
class PdfBuilder {
  readonly doc: jsPDF;
  private readonly pageWidth: number;
  private readonly pageHeight: number;
  private readonly contentWidth: number;
  private y: number;

  constructor() {
    this.doc = new jsPDF({ unit: "pt", format: "a4" });
    this.pageWidth = this.doc.internal.pageSize.getWidth();
    this.pageHeight = this.doc.internal.pageSize.getHeight();
    this.contentWidth = this.pageWidth - MARGIN * 2;
    this.y = MARGIN;
  }

  private ensureSpace(needed: number) {
    if (this.y + needed > this.pageHeight - MARGIN) {
      this.doc.addPage();
      this.y = MARGIN;
    }
  }

  gap(points: number) {
    this.y += points;
  }

  /** Title band with the eyebrow/title/subtitle used at the top of each export. */
  header(eyebrow: string, title: string, subtitle: string) {
    this.doc.setFillColor(...BRAND);
    this.doc.rect(0, 0, this.pageWidth, 96, "F");

    this.doc.setTextColor(255, 255, 255);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(9);
    this.doc.text(eyebrow.toUpperCase(), MARGIN, 34);

    this.doc.setFontSize(22);
    this.doc.text(this.doc.splitTextToSize(title, this.contentWidth), MARGIN, 58);

    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(10);
    this.doc.text(subtitle, MARGIN, 80);

    this.y = 96 + 28;
  }

  /** Section heading, e.g. "Key topics". */
  heading(text: string) {
    this.ensureSpace(40);
    this.gap(6);
    this.doc.setTextColor(...BRAND);
    this.doc.setFont("helvetica", "bold");
    this.doc.setFontSize(13);
    this.doc.text(text, MARGIN, this.y);
    this.y += 10;
    this.doc.setDrawColor(...BRAND);
    this.doc.setLineWidth(1);
    this.doc.line(MARGIN, this.y, MARGIN + this.contentWidth, this.y);
    this.y += 16;
  }

  /** A wrapped run of body text. `indent` and `muted` cover list items and captions. */
  paragraph(
    text: string,
    opts: {
      size?: number;
      style?: "normal" | "bold";
      muted?: boolean;
      indent?: number;
      spaceAfter?: number;
    } = {},
  ) {
    const size = opts.size ?? 11;
    const indent = opts.indent ?? 0;
    const lineHeight = size * 1.4;
    this.doc.setFont("helvetica", opts.style ?? "normal");
    this.doc.setFontSize(size);
    this.doc.setTextColor(...(opts.muted ? MUTED : INK));

    const lines = this.doc.splitTextToSize(
      text,
      this.contentWidth - indent,
    ) as string[];
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.doc.text(line, MARGIN + indent, this.y);
      this.y += lineHeight;
    }
    this.y += opts.spaceAfter ?? 0;
  }

  /** A "• " prefixed line where the bullet hangs and text wraps under itself. */
  bullet(text: string) {
    this.doc.setFont("helvetica", "normal");
    this.doc.setFontSize(11);
    this.doc.setTextColor(30, 30, 30);
    this.ensureSpace(15);
    this.doc.text("•", MARGIN, this.y);
    this.paragraph(text, { indent: 16, spaceAfter: 4 });
  }
}

/** Sanitise a title into a filesystem-safe .pdf name. */
function fileName(base: string): string {
  const safe = base
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return `${safe || "summary"}.pdf`;
}

/**
 * Deliver the built PDF. Native → OS share sheet; web → download.
 * A user dismissing the native share sheet is not an error and is swallowed.
 */
async function deliver(name: string, doc: jsPDF): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    doc.save(name);
    return;
  }

  // datauristring → "data:application/pdf;filename=…;base64,XXXX"
  const base64 = doc.output("datauristring").split(",")[1] ?? "";
  await Filesystem.writeFile({
    path: name,
    data: base64,
    directory: Directory.Cache,
  });
  const { uri } = await Filesystem.getUri({
    path: name,
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: name, url: uri, dialogTitle: "Export PDF" });
  } catch (error) {
    // The share plugin rejects when the user cancels the sheet — not a failure.
    const message = error instanceof Error ? error.message : String(error);
    if (!/cancel/i.test(message)) throw error;
  }
}

export async function exportMeetingPdf(meeting: MeetingPdfInput): Promise<void> {
  const b = new PdfBuilder();
  b.header(
    "Individual meeting",
    meeting.title,
    `${longDate(meeting.startedAtMs)} at ${timeOfDay(meeting.startedAtMs)} · ${formatDuration(meeting.durationMs)}`,
  );

  b.heading("AI summary");
  b.paragraph(meeting.summaryOverview?.trim() || "No summary was generated.", {
    spaceAfter: 8,
  });

  b.heading("Key topics");
  if (meeting.keyTopics?.length) {
    for (const topic of meeting.keyTopics) {
      b.paragraph(topic.topic, { style: "bold", spaceAfter: 2 });
      if (topic.details) b.paragraph(topic.details, { muted: true, spaceAfter: 8 });
    }
  } else {
    b.paragraph("No distinct topics were captured.", { muted: true });
  }

  b.heading("Decisions");
  if (meeting.decisions?.length) {
    for (const decision of meeting.decisions) {
      b.paragraph(decision.decision, { style: "bold", spaceAfter: 2 });
      if (decision.context)
        b.paragraph(decision.context, { muted: true, spaceAfter: 8 });
    }
  } else {
    b.paragraph("No explicit decisions were detected.", { muted: true });
  }

  b.heading("Action items");
  if (meeting.actionItems?.length) {
    for (const item of meeting.actionItems) {
      b.paragraph(item.task, { style: "bold", spaceAfter: 2 });
      b.paragraph(`${item.owner} · due ${item.dueDate}`, {
        size: 9,
        muted: true,
        spaceAfter: 8,
      });
    }
  } else {
    b.paragraph("No explicit action items were detected.", { muted: true });
  }

  if (meeting.summaryGeneratedAtMs) {
    b.gap(12);
    b.paragraph(
      `Generated by UnRecorded · ${longDate(meeting.summaryGeneratedAtMs)}`,
      { size: 8, muted: true },
    );
  }

  await deliver(fileName(meeting.title), b.doc);
}

export async function exportDailyPdf(day: DailyPdfInput): Promise<void> {
  const b = new PdfBuilder();
  const dayDate = new Date(`${day.localDate}T00:00:00`);
  const heading = dayDate.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  b.header("Daily roll-up", heading, `UnRecorded · ${day.localDate}`);

  b.heading("Overview");
  b.paragraph(day.overview?.trim() || "No overview was generated.", {
    spaceAfter: 8,
  });

  b.heading("Highlights");
  if (day.highlights.length) {
    for (const highlight of day.highlights) b.bullet(highlight);
  } else {
    b.paragraph("No highlights were recorded for this day.", { muted: true });
  }

  b.heading("Action items");
  if (day.actionItems.length) {
    for (const item of day.actionItems) {
      b.paragraph(item.task, { style: "bold", spaceAfter: 2 });
      b.paragraph(`${item.owner} · due ${item.dueDate}`, {
        size: 9,
        muted: true,
        spaceAfter: 8,
      });
    }
  } else {
    b.paragraph("No commitments were captured for this day.", { muted: true });
  }

  if (day.generatedAtMs) {
    b.gap(12);
    b.paragraph(`Generated by UnRecorded · ${longDate(day.generatedAtMs)}`, {
      size: 8,
      muted: true,
    });
  }

  await deliver(fileName(`echo-ledger-${day.localDate}`), b.doc);
}
