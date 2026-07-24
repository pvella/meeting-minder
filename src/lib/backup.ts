import { Directory, Filesystem, Encoding } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { db } from "./sqlite";
import {
  dailySummaries,
  meetings,
  type DailySummary,
  type Meeting,
} from "./schema";

/**
 * On-device export / import. This is the app's safety net: everything durable
 * — every meeting (with its action items, decisions, topics and summary) and
 * every daily roll-up — is written to a single JSON file the user can save or
 * share off-device, and read back to restore. Transient audio artifacts
 * (audioChunks / transcriptSegments) are deliberately excluded: they are
 * deleted once a summary exists and are not part of the durable record.
 */

const BACKUP_KIND = "unrecorded-backup" as const;
const BACKUP_VERSION = 1;

export type BackupFile = {
  kind: typeof BACKUP_KIND;
  version: number;
  exportedAtMs: number;
  meetings: Meeting[];
  dailySummaries: DailySummary[];
};

export type ImportResult = {
  meetingsAdded: number;
  dailySummariesAdded: number;
  meetingsSkipped: number;
  dailySummariesSkipped: number;
};

export async function buildBackup(): Promise<BackupFile> {
  const [m, d] = await Promise.all([
    db.select().from(meetings),
    db.select().from(dailySummaries),
  ]);
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAtMs: Date.now(),
    meetings: m,
    dailySummaries: d,
  };
}

function backupFilename(exportedAtMs: number): string {
  // Local date-time, filesystem-safe: unrecorded-backup-2026-07-24-2312.json
  const d = new Date(exportedAtMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `unrecorded-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

/**
 * Write the backup to a file and hand it to the OS share sheet (save to Files,
 * send to Drive, email it, etc.). On the web dev build, falls back to a plain
 * browser download.
 */
export async function exportBackup(): Promise<{
  filename: string;
  meetings: number;
  dailySummaries: number;
}> {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const filename = backupFilename(backup.exportedAtMs);

  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return {
      filename,
      meetings: backup.meetings.length,
      dailySummaries: backup.dailySummaries.length,
    };
  }

  // Cache dir is app-scoped and world-shareable via FileProvider.
  await Filesystem.writeFile({
    path: filename,
    data: json,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  const { uri } = await Filesystem.getUri({
    path: filename,
    directory: Directory.Cache,
  });
  await Share.share({
    title: "UnRecorded backup",
    text: "Your UnRecorded meetings and action items.",
    url: uri,
    dialogTitle: "Save or share your backup",
  });

  return {
    filename,
    meetings: backup.meetings.length,
    dailySummaries: backup.dailySummaries.length,
  };
}

export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON — it may be corrupted.");
  }
  const b = data as Partial<BackupFile>;
  if (
    !b ||
    b.kind !== BACKUP_KIND ||
    !Array.isArray(b.meetings) ||
    !Array.isArray(b.dailySummaries)
  ) {
    throw new Error("This doesn't look like an UnRecorded backup file.");
  }
  return b as BackupFile;
}

/**
 * Pure merge planner (no db). Meetings are matched by their start time and
 * daily summaries by their date, so importing the same file twice is a no-op
 * and importing into a populated database merges rather than clobbers. Original
 * ids are stripped from the rows to insert, so autoincrement assigns fresh,
 * collision-free ids. Kept pure so the restore logic is unit-testable without
 * a database.
 */
export function planRestore(
  backup: BackupFile,
  existing: { startedAtMs: number[]; localDates: string[] },
): {
  meetingsToInsert: Omit<Meeting, "id">[];
  dailyToInsert: Omit<DailySummary, "id">[];
  meetingsSkipped: number;
  dailySummariesSkipped: number;
} {
  const starts = new Set(existing.startedAtMs);
  const dates = new Set(existing.localDates);

  const meetingsToInsert: Omit<Meeting, "id">[] = [];
  let meetingsSkipped = 0;
  for (const m of backup.meetings) {
    if (starts.has(m.startedAtMs)) {
      meetingsSkipped++;
      continue;
    }
    starts.add(m.startedAtMs);
    const { id: _id, ...row } = m;
    void _id;
    meetingsToInsert.push(row);
  }

  const dailyToInsert: Omit<DailySummary, "id">[] = [];
  let dailySummariesSkipped = 0;
  for (const d of backup.dailySummaries) {
    if (dates.has(d.localDate)) {
      dailySummariesSkipped++;
      continue;
    }
    dates.add(d.localDate);
    const { id: _id, ...row } = d;
    void _id;
    dailyToInsert.push(row);
  }

  return {
    meetingsToInsert,
    dailyToInsert,
    meetingsSkipped,
    dailySummariesSkipped,
  };
}

/** Additive restore: reads existing keys, plans the merge, inserts new rows. */
export async function restoreBackup(backup: BackupFile): Promise<ImportResult> {
  const existingMeetings = await db
    .select({ startedAtMs: meetings.startedAtMs })
    .from(meetings);
  const existingDaily = await db
    .select({ localDate: dailySummaries.localDate })
    .from(dailySummaries);

  const plan = planRestore(backup, {
    startedAtMs: existingMeetings.map(r => r.startedAtMs),
    localDates: existingDaily.map(r => r.localDate),
  });

  for (const row of plan.meetingsToInsert) {
    await db.insert(meetings).values(row);
  }
  for (const row of plan.dailyToInsert) {
    await db.insert(dailySummaries).values(row);
  }

  return {
    meetingsAdded: plan.meetingsToInsert.length,
    meetingsSkipped: plan.meetingsSkipped,
    dailySummariesAdded: plan.dailyToInsert.length,
    dailySummariesSkipped: plan.dailySummariesSkipped,
  };
}
