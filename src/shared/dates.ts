// Calendar days are plain YYYY-MM-DD strings. UTC keeps the arithmetic free of DST jumps.

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

/** A wall-clock time such as 2026-11-14T19:00. */
export function isLocalDateTime(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d$/.exec(value);
  return !!match && isDay(match[1]);
}

export function addDays(day: string, count: number): string {
  return fromUtc(toUtc(day) + count * DAY_MS);
}

/** Whole days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

export function weekday(day: string): number {
  return new Date(toUtc(day)).getUTCDay();
}

export function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export function addMonths(day: string, count: number): string {
  const [y, m] = day.split("-").map(Number);
  return fromUtc(Date.UTC(y, m - 1 + count, 1));
}

export function lastOfMonth(day: string): string {
  return addDays(addMonths(day, 1), -1);
}
