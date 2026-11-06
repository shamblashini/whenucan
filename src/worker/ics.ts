/** A wall-clock time ("2026-11-13T18:30") in an IANA time zone, as a UTC timestamp. */
export function zonedToUtc(local: string, timezone: string): number {
  const wall = Date.parse(`${local}:00Z`);
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(format.formatToParts(instant).map((part) => [part.type, Number(part.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
  };
  // The second pass corrects the offset when the first guess lands on the other side of a clock change.
  return wall - offsetAt(wall - offsetAt(wall));
}

const stamp = (instant: number) => new Date(instant).toISOString().replace(/[-:]|\.\d{3}/g, "");

const escapeText = (text: string) =>
  text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** The format limits lines to 75 bytes. Longer ones continue on the next line after a space. */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += character;
    bytes += size;
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** One event as an .ics file. Times are in UTC, so the file doesn't need to describe the time zone's rules. */
export function calendarFile(event: {
  uid: string;
  title: string;
  description: string;
  url: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  now?: number;
}): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//whenucan//whenucan//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(event.now ?? Date.now())}`,
    `DTSTART:${stamp(zonedToUtc(event.startsAt, event.timezone))}`,
    `DTEND:${stamp(zonedToUtc(event.endsAt, event.timezone))}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `URL:${event.url}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ]
    .map(foldLine)
    .join("\r\n");
}
