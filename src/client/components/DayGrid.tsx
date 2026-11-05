import { useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { addDays, addMonths, eachDay, firstOfMonth, lastOfMonth, weekday } from "@shared/dates";
import type { Vote } from "@shared/types";
import { VOTE_LABEL, firstWeekday, formatDayLong, formatMonth, weekdayLabels } from "../format";
import { Glyph } from "./ui";

export interface Tally {
  yes: number;
  ok: number;
  no: number;
}

interface Props {
  startDate: string;
  endDate: string;
  today: string;
  mode: "mine" | "everyone";
  mine: Record<string, Vote | undefined>;
  tallies: Record<string, Tally | undefined>;
  people: number;
  brush: Vote;
  bestDays?: string[];
  selectedDay?: string | null;
  onPaint: (day: string, value: Vote | null) => void;
  onSelectDay?: (day: string) => void;
}

function monthsInRange(start: string, end: string): string[] {
  const months: string[] = [];
  for (let month = firstOfMonth(start); month <= end; month = addMonths(month, 1)) months.push(month);
  return months;
}

/**
 * Tap to mark, drag to mark several. On touch, marking waits until the gesture is clearly a
 * tap or a sideways drag, so scrolling the page never marks the day under the finger.
 */
export function DayGrid(props: Props) {
  const { startDate, endDate, today, mode, mine, tallies, people, brush, bestDays, selectedDay, onPaint, onSelectDay } = props;
  const first = useMemo(firstWeekday, []);
  const labels = useMemo(() => weekdayLabels(first), [first]);
  const months = useMemo(() => monthsInRange(startDate, endDate), [startDate, endDate]);
  const root = useRef<HTMLDivElement>(null);
  const justPainted = useRef(new Set<string>());
  const gesture = useRef<{
    pointerId: number;
    touch: boolean;
    action: Vote | null;
    startDay: string;
    x: number;
    y: number;
    dragging: boolean;
    last: string;
  } | null>(null);

  const isOpen = (day: string) => day >= today && day >= startDate && day <= endDate;

  const paint = (day: string, value: Vote | null) => {
    justPainted.current.add(day);
    onPaint(day, value);
  };

  const dayAt = (x: number, y: number): string | null => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day]");
    return element && root.current?.contains(element) && !(element as HTMLButtonElement).disabled ? element.dataset.day! : null;
  };

  const onPointerDown = (event: ReactPointerEvent) => {
    if (mode !== "mine" || (event.pointerType === "mouse" && event.button !== 0)) return;
    const day = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-day]");
    if (!day || day.disabled) return;
    const startDay = day.dataset.day!;
    const action = mine[startDay] === brush ? null : brush;
    const touch = event.pointerType === "touch";
    gesture.current = { pointerId: event.pointerId, touch, action, startDay, x: event.clientX, y: event.clientY, dragging: !touch, last: startDay };
    if (touch) (event.target as Element).releasePointerCapture?.(event.pointerId);
    else {
      event.preventDefault();
      day.focus({ preventScroll: true });
      paint(startDay, action);
    }
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (!active.dragging) {
      if (Math.abs(event.clientX - active.x) < 10) return;
      active.dragging = true;
      paint(active.startDay, active.action);
    }
    // A fast drag reports points far apart, so walk the line between them to not skip days.
    const steps = Math.ceil(Math.hypot(event.clientX - active.x, event.clientY - active.y) / 12) || 1;
    for (let step = 1; step <= steps; step++) {
      const x = active.x + ((event.clientX - active.x) * step) / steps;
      const y = active.y + ((event.clientY - active.y) * step) / steps;
      const day = dayAt(x, y);
      if (day && day !== active.last) {
        active.last = day;
        paint(day, active.action);
      }
    }
    active.x = event.clientX;
    active.y = event.clientY;
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.touch && !active.dragging) paint(active.startDay, active.action);
    gesture.current = null;
  };

  // Keyboards and screen readers produce a click with no pointer, and in everyone mode a click selects.
  const onClick = (event: React.MouseEvent, day: string) => {
    if (mode === "everyone") onSelectDay?.(day);
    else if (event.detail === 0) paint(day, mine[day] === brush ? null : brush);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: string) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    root.current?.querySelector<HTMLButtonElement>(`[data-day="${addDays(day, move)}"]:not(:disabled)`)?.focus();
  };

  return (
    <div
      ref={root}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (gesture.current = null)}
      className="space-y-5"
    >
      {months.map((month) => {
        const days = eachDay(month, lastOfMonth(month));
        const blanks = (weekday(month) - first + 7) % 7;
        return (
          <section key={month} aria-label={formatMonth(month)}>
            <h3 className="mb-1.5 font-bold">{formatMonth(month)}</h3>
            <div className="grid grid-cols-7 gap-1" role="presentation">
              {labels.map((label) => (
                <div key={label} className="pb-0.5 text-center text-sm text-soft">
                  {label}
                </div>
              ))}
              {Array.from({ length: blanks }, (_, i) => (
                <div key={i} />
              ))}
              {days.map((day) =>
                day < startDate || day > endDate ? (
                  <div key={day} />
                ) : (
                  <DayCell
                    key={day}
                    day={day}
                    mode={mode}
                    mine={mine[day]}
                    tally={tallies[day]}
                    people={people}
                    today={day === today}
                    open={mode === "everyone" || isOpen(day)}
                    best={mode === "everyone" && !!bestDays?.includes(day)}
                    selected={mode === "everyone" && selectedDay === day}
                    sweep={justPainted.current.has(day)}
                    onClick={onClick}
                    onKeyDown={onKeyDown}
                  />
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DayCell({
  day, mode, mine, tally, people, today, open, best, selected, sweep, onClick, onKeyDown,
}: {
  day: string;
  mode: "mine" | "everyone";
  mine?: Vote;
  tally?: Tally;
  people: number;
  today: boolean;
  open: boolean;
  best: boolean;
  selected: boolean;
  sweep: boolean;
  onClick: (event: React.MouseEvent, day: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, day: string) => void;
}) {
  const number = Number(day.slice(8));
  const counts = tally ?? { yes: 0, ok: 0, no: 0 };
  const answered = counts.yes + counts.ok + counts.no;
  const summary = `${counts.yes} yes, ${counts.ok} OK, ${counts.no} no`;
  const label =
    mode === "mine"
      ? `${formatDayLong(day)}: ${mine ? `you said ${VOTE_LABEL[mine]}` : "no answer"}. Group: ${summary}`
      : `${formatDayLong(day)}: ${summary}, of ${people} ${people === 1 ? "person" : "people"}`;
  return (
    <button
      type="button"
      className="day"
      data-day={day}
      data-today={today || undefined}
      data-best={best || undefined}
      data-selected={selected || undefined}
      data-vote={mode === "mine" ? mine : undefined}
      disabled={!open}
      aria-label={label}
      aria-pressed={mode === "mine" ? !!mine : selected}
      onClick={(event) => onClick(event, day)}
      onKeyDown={(event) => onKeyDown(event, day)}
    >
      <span className="day-num">{number}</span>
      {mode === "mine" && mine && (
        <>
          <span key={mine} className={`mark mark-${mine} ${sweep ? "sweep" : ""}`} data-shape={number % 3} />
          {mine !== "no" && <Glyph value={mine} className="day-glyph" />}
        </>
      )}
      {mode === "mine" && answered > 0 && (
        <span className="tally" aria-hidden="true">
          <span className="bg-yes-solid" style={{ flexGrow: counts.yes }} />
          <span className="bg-ok-solid" style={{ flexGrow: counts.ok }} />
          <span className="bg-no-solid" style={{ flexGrow: counts.no }} />
        </span>
      )}
      {mode === "everyone" && answered > 0 && (
        <>
          <span className="stack" aria-hidden="true">
            <span className="bg-yes" style={{ height: `${(counts.yes / people) * 100}%` }} />
            <span className="bg-ok" style={{ height: `${(counts.ok / people) * 100}%` }} />
            <span className="bg-no" style={{ height: `${(counts.no / people) * 100}%` }} />
          </span>
          <span className="day-count" aria-hidden="true">
            {counts.yes + counts.ok}/{people}
          </span>
        </>
      )}
    </button>
  );
}

export function MarkerTray({ brush, onChange, tiny }: { brush: Vote; onChange: (value: Vote) => void; tiny?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Marker" className={`flex gap-2 ${tiny ? "" : "w-full"}`}>
      {(["yes", "ok", "no"] as Vote[]).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={brush === value}
          className="pen"
          data-v={value}
          data-picked={brush === value}
          data-dim={brush !== value}
          onClick={() => onChange(value)}
        >
          <Glyph value={value} className="h-4 w-4" />
          {VOTE_LABEL[value]}
        </button>
      ))}
    </div>
  );
}
