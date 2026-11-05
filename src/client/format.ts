import type { Vote } from "@shared/types";

const utc = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00Z` : `${value}:00Z`);

const format = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { timeZone: "UTC", ...options }).format(utc(value));

export const formatDay = (day: string) => format(day, { weekday: "short", day: "numeric", month: "short" });
export const formatDayLong = (day: string) => format(day, { weekday: "long", day: "numeric", month: "long" });
export const formatWeekday = (day: string) => format(day, { weekday: "short" });
export const formatDayNumber = (day: string) => format(day, { day: "numeric" });
export const formatMonthShort = (day: string) => format(day, { month: "short" });
export const formatMonth = (day: string) => format(day, { month: "long", year: "numeric" });
export const formatShort = (day: string) => format(day, { day: "numeric", month: "short" });
const formatTime = (value: string) => format(value, { hour: "numeric", minute: "2-digit" });

export function formatRangeDays(start: string, end: string): string {
  if (start === end) return formatDay(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const startText = format(start, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  return `${startText} to ${format(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function formatProposalTime(startsAt: string, endsAt: string): string {
  const sameDay = startsAt.slice(0, 10) === endsAt.slice(0, 10);
  const start = `${formatDay(startsAt.slice(0, 10))}, ${formatTime(startsAt)}`;
  return sameDay ? `${start} to ${formatTime(endsAt)}` : `${start} to ${formatDay(endsAt.slice(0, 10))}, ${formatTime(endsAt)}`;
}

export function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 0 is Sunday. Follows the visitor's locale where the browser reports it, otherwise Monday. */
export function firstWeekday(): number {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info) return info.firstDay % 7;
  } catch {
    // Fall through to Monday.
  }
  return 1;
}

export function weekdayLabels(first: number): string[] {
  const labels: string[] = [];
  for (let i = 0; i < 7; i++) {
    // 2 January 2000 was a Sunday.
    labels.push(format(`2000-01-${String(2 + ((first + i) % 7)).padStart(2, "0")}`, { weekday: "short" }));
  }
  return labels;
}

export const VOTE_LABEL: Record<Vote, string> = { yes: "Yes", ok: "OK", no: "No" };
export const VOTES: Vote[] = ["yes", "ok", "no"];

export function timezoneLabel(timezone: string): string {
  return (timezone.split("/").pop() ?? timezone).replaceAll("_", " ");
}

export function viewerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
