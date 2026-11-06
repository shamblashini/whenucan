import type { Vote } from "@shared/types";
import { localeTag, t } from "./i18n";

const utc = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00Z` : `${value}:00Z`);

// The calendar grid is Gregorian, so dates must be too, even where a language defaults to another
// calendar (Persian and Thai do). Latin digits match the numbers in the grid and in the translations.
const format = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(localeTag(), { timeZone: "UTC", calendar: "gregory", numberingSystem: "latn", ...options }).format(utc(value));

export const formatDay = (day: string) => format(day, { weekday: "short", day: "numeric", month: "short" });
export const formatDayLong = (day: string) => format(day, { weekday: "long", day: "numeric", month: "long" });
export const formatWeekday = (day: string) => format(day, { weekday: "short" });
export const formatDayNumber = (day: string) => format(day, { day: "numeric" });
export const formatMonthShort = (day: string) => format(day, { month: "short" });
export const formatMonth = (day: string) => format(day, { month: "long", year: "numeric" });
export const formatShort = (day: string) => format(day, { day: "numeric", month: "short" });
const formatTime = (value: string) => format(value, { hour: "numeric", minute: "2-digit", hourCycle: hourCycle() });

/**
 * Browsers only reveal a clock format through the language, and many people in Europe use an
 * en-US browser. So 12-hour time needs both a 12-hour language and a time zone outside Europe.
 */
export function prefers24Hour(tag: string, timezone: string): boolean {
  if (timezone.startsWith("Europe/")) return true;
  const cycle = new Intl.DateTimeFormat(tag, { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle !== "h11" && cycle !== "h12";
}

const hourCycle = () => (prefers24Hour(localeTag(), viewerTimezone()) ? "h23" : "h12");

export function formatRangeDays(start: string, end: string): string {
  if (start === end) return formatDay(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const startText = format(start, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  return t("date.range", { start: startText, end: format(end, { day: "numeric", month: "short", year: "numeric" }) });
}

export function formatProposalTime(startsAt: string, endsAt: string): string {
  const sameDay = startsAt.slice(0, 10) === endsAt.slice(0, 10);
  const start = formatList([formatDay(startsAt.slice(0, 10)), formatTime(startsAt)]);
  return t("date.range", { start, end: sameDay ? formatTime(endsAt) : formatList([formatDay(endsAt.slice(0, 10)), formatTime(endsAt)]) });
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
  const labels = (weekday: "short" | "narrow") =>
    // 2 January 2000 was a Sunday.
    Array.from({ length: 7 }, (_, i) => format(`2000-01-${String(2 + ((first + i) % 7)).padStart(2, "0")}`, { weekday }));
  const short = labels("short");
  // Some languages, like Arabic, have no short names that fit a calendar column.
  return short.some((label) => label.length > 5) ? labels("narrow") : short;
}

export const voteLabel = (value: Vote) => t(`vote.${value}`);
export const VOTES: Vote[] = ["yes", "ok", "no"];

const LIST_SEPARATORS: Record<string, string> = { ar: "، ", fa: "، ", ja: "、", zh: "、" };

/** Joins items with the comma the page's language uses. */
export function formatList(items: string[]): string {
  return items.join(LIST_SEPARATORS[localeTag().split("-")[0]] ?? ", ");
}

export function timezoneLabel(timezone: string): string {
  return (timezone.split("/").pop() ?? timezone).replaceAll("_", " ");
}

export function viewerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Opens Google's new event form, filled in. Proposals are wall-clock times, so `ctz` says which zone they mean. */
export function googleCalendarUrl(event: { title: string; startsAt: string; endsAt: string; timezone: string; details: string }): string {
  const stamp = (value: string) => `${value.replace(/[-:]/g, "")}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${stamp(event.startsAt)}/${stamp(event.endsAt)}`,
    ctz: event.timezone,
    details: event.details,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
