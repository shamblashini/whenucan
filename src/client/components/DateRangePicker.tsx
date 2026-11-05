import { useMemo, useState } from "react";
import { addDays, addMonths, daysBetween, eachDay, firstOfMonth, lastOfMonth, weekday } from "@shared/dates";
import { LIMITS } from "@shared/limits";
import { firstWeekday, formatDayLong, formatMonth, formatRangeDays, localToday, weekdayLabels } from "../format";

export interface Range {
  start: string;
  end: string | null;
}

export function DateRangePicker({ value, onChange, minDay }: { value: Range; onChange: (next: Range) => void; minDay?: string }) {
  const today = useMemo(localToday, []);
  const min = minDay ?? today;
  const first = useMemo(firstWeekday, []);
  const labels = useMemo(() => weekdayLabels(first), [first]);
  const [month, setMonth] = useState(firstOfMonth(value.start));
  const [hover, setHover] = useState<string | null>(null);

  const pick = (day: string) => {
    if (value.end !== null || day < value.start) onChange({ start: day, end: null });
    else if (daysBetween(value.start, day) < LIMITS.rangeDays) onChange({ start: value.start, end: day });
  };

  const previewEnd = value.end ?? (hover && hover >= value.start ? hover : null);
  const days = eachDay(month, lastOfMonth(month));
  const blanks = (weekday(month) - first + 7) % 7;

  const presets = [
    { label: "Next 7 days", start: today, end: addDays(today, 6) },
    { label: "Next 2 weeks", start: today, end: addDays(today, 13) },
    { label: "Next 30 days", start: today, end: addDays(today, 29) },
    { label: "Next month", start: addMonths(today, 1), end: lastOfMonth(addMonths(today, 1)) },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="chip"
            onClick={() => {
              onChange({ start: preset.start, end: preset.end });
              setMonth(firstOfMonth(preset.start));
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="rounded-lg border-[1.5px] border-rule bg-sheet p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <button type="button" className="btn btn-quiet min-w-11 text-2xl leading-none no-underline" aria-label="Previous month" disabled={month <= firstOfMonth(min)} onClick={() => setMonth(addMonths(month, -1))}>
            ‹
          </button>
          <span className="font-bold" aria-live="polite">
            {formatMonth(month)}
          </span>
          <button type="button" className="btn btn-quiet min-w-11 text-2xl leading-none no-underline" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7" onPointerLeave={() => setHover(null)}>
          {labels.map((label) => (
            <div key={label} className="pb-1 text-center text-sm text-soft">
              {label}
            </div>
          ))}
          {Array.from({ length: blanks }, (_, i) => (
            <div key={i} />
          ))}
          {days.map((day) => {
            const isEnd = day === value.start || day === previewEnd;
            const inside = previewEnd !== null && day > value.start && day < previewEnd;
            return (
              <button
                key={day}
                type="button"
                className="range-day"
                disabled={day < min}
                data-state={isEnd ? "end" : inside ? "in" : undefined}
                aria-label={formatDayLong(day)}
                aria-pressed={isEnd || inside}
                onPointerEnter={() => setHover(day)}
                onClick={() => pick(day)}
              >
                {Number(day.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-soft" aria-live="polite">
        {value.end
          ? `${formatRangeDays(value.start, value.end)} (${daysBetween(value.start, value.end) + 1} ${value.start === value.end ? "day" : "days"})`
          : "Now tap the last day. Tap the same day again for a single date."}
      </p>
    </div>
  );
}
