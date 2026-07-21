import type { LocalDay } from "@shared/meeting";

/** Zero-padded HH:MM:SS. Used for both the live recording timer and transcript offsets. */
export function formatTimer(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map(value => value.toString().padStart(2, "0"))
    .join(":");
}

/** Human-readable length, e.g. "48 min" or "1 h 12 min". */
export function formatDuration(milliseconds: number) {
  const totalMinutes = Math.round(Math.max(0, milliseconds) / 60_000);
  if (totalMinutes < 1) return "under a minute";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function timeOfDay(timestampMs: number) {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function shortDate(timestampMs: number) {
  return new Date(timestampMs).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function longDate(timestampMs: number) {
  return new Date(timestampMs).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildLocalDay(date: Date): LocalDay {
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  const dayOfMonth = date.getDate();
  const dayStart = new Date(year, monthIndex, dayOfMonth);
  const dayEnd = new Date(year, monthIndex, dayOfMonth + 1);
  return {
    localDate: `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(dayOfMonth).padStart(2, "0")}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    dayStartAtMs: dayStart.getTime(),
    dayEndAtMs: dayEnd.getTime(),
  };
}

/** Local-calendar-day bounds for a timestamp. Day boundaries are local, never UTC. */
export function getLocalDay(timestampMs: number): LocalDay {
  return buildLocalDay(new Date(timestampMs));
}

/**
 * Rebuild day bounds from a stored "YYYY-MM-DD" key. Parsed as local components
 * rather than via Date.parse, which would treat the bare date as UTC and shift
 * the day backwards for anyone east of Greenwich.
 */
export function getLocalDayFromKey(localDate: string): LocalDay {
  const [year, month, day] = localDate.split("-").map(Number);
  return buildLocalDay(new Date(year, (month ?? 1) - 1, day ?? 1));
}
