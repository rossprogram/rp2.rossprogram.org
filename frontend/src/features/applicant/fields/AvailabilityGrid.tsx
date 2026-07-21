import { useMemo, useRef, useState, useEffect } from 'react';
import type { Question } from '@rp2/shared';

type Slot = { weekday: number; startMin: number; endMin: number };

type Props = {
  question: Question & { type: 'availability_grid' };
  value: unknown;
  disabled?: boolean | undefined;
  onSave: (value: unknown) => void;
};

// 30-min slots from 6:00 to 24:00 = 36 slots
const SLOT_MIN = 30;
const DAY_START_MIN = 6 * 60;
const DAY_END_MIN = 24 * 60;
const SLOTS_PER_DAY = (DAY_END_MIN - DAY_START_MIN) / SLOT_MIN;
const WEEKDAYS: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function slotIndex(startMin: number): number {
  return (startMin - DAY_START_MIN) / SLOT_MIN;
}
function slotToMin(idx: number): number {
  return DAY_START_MIN + idx * SLOT_MIN;
}

function parseRanges(v: unknown): boolean[][] {
  const grid: boolean[][] = Array.from({ length: 7 }, () =>
    Array(SLOTS_PER_DAY).fill(false),
  );
  if (!Array.isArray(v)) return grid;
  for (const r of v) {
    if (!r || typeof r !== 'object') continue;
    const rr = r as Slot;
    if (
      !Number.isInteger(rr.weekday) ||
      !Number.isInteger(rr.startMin) ||
      !Number.isInteger(rr.endMin)
    )
      continue;
    if (rr.weekday < 0 || rr.weekday > 6) continue;
    for (let m = rr.startMin; m < rr.endMin; m += SLOT_MIN) {
      const idx = slotIndex(m);
      if (idx >= 0 && idx < SLOTS_PER_DAY) {
        const row = grid[rr.weekday];
        if (row) row[idx] = true;
      }
    }
  }
  return grid;
}

function gridToRanges(grid: readonly (readonly boolean[])[]): Slot[] {
  const ranges: Slot[] = [];
  for (let d = 0; d < 7; d++) {
    const row = grid[d];
    if (!row) continue;
    let start: number | null = null;
    for (let i = 0; i < SLOTS_PER_DAY; i++) {
      if (row[i]) {
        if (start === null) start = i;
      } else if (start !== null) {
        ranges.push({ weekday: d, startMin: slotToMin(start), endMin: slotToMin(i) });
        start = null;
      }
    }
    if (start !== null) {
      ranges.push({
        weekday: d,
        startMin: slotToMin(start),
        endMin: slotToMin(SLOTS_PER_DAY),
      });
    }
  }
  return ranges;
}

function formatHour(min: number): string {
  const h = Math.floor(min / 60);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}${suffix}`;
}

export function AvailabilityGrid({ question, value, disabled, onSave }: Props) {
  const parsed = useMemo(() => parseRanges(value), [value]);
  const [grid, setGrid] = useState<boolean[][]>(parsed);
  useEffect(() => setGrid(parsed), [parsed]);

  const dragMode = useRef<null | boolean>(null);
  const [isDragging, setIsDragging] = useState(false);

  function updateCell(d: number, i: number, on: boolean) {
    setGrid((g) => {
      const row = g[d];
      if (!row || row[i] === on) return g;
      const next = g.map((r) => r.slice());
      const nextRow = next[d];
      if (!nextRow) return g;
      nextRow[i] = on;
      return next;
    });
  }

  function onCellDown(d: number, i: number) {
    if (disabled) return;
    const row = grid[d];
    const currently = row?.[i] ?? false;
    dragMode.current = !currently;
    setIsDragging(true);
    updateCell(d, i, !currently);
  }

  function onCellEnter(d: number, i: number) {
    if (!isDragging || dragMode.current === null) return;
    updateCell(d, i, dragMode.current);
  }

  function endDrag() {
    if (!isDragging) return;
    setIsDragging(false);
    dragMode.current = null;
    onSave(gridToRanges(grid));
  }

  useEffect(() => {
    if (!isDragging) return;
    function up() {
      endDrag();
    }
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, grid]);

  const hourMarks: number[] = [];
  for (let m = DAY_START_MIN; m <= DAY_END_MIN; m += 120) hourMarks.push(m);

  return (
    <div className="mb-8">
      <div className="block text-ink leading-snug">
        {question.prompt}
        {question.required && <RequiredMark />}
      </div>
      {question.help && (
        <div className="block text-muted text-sm italic mt-1">{question.help}</div>
      )}

      <div className="mt-4 select-none">
        <div className="flex mb-1 ml-12">
          {WEEKDAYS.map((d) => (
            <div key={d} className="flex-1 text-center smallcaps text-muted">
              {d}
            </div>
          ))}
        </div>

        <div className="flex">
          <div
            className="w-12 relative text-right pr-2 text-muted"
            style={{ height: `${SLOTS_PER_DAY * 14}px` }}
          >
            {hourMarks.map((m) => (
              <div
                key={m}
                className="absolute right-2 -translate-y-1/2 text-xs font-mono"
                style={{ top: `${((m - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * 100}%` }}
              >
                {formatHour(m)}
              </div>
            ))}
          </div>

          <div
            className="flex flex-1 border border-rule bg-white"
            style={{ touchAction: 'none' }}
            onMouseLeave={() => {
              if (isDragging) endDrag();
            }}
          >
            {WEEKDAYS.map((_, d) => (
              <div key={d} className="flex-1 flex flex-col">
                {Array.from({ length: SLOTS_PER_DAY }).map((_, i) => {
                  const on = grid[d]?.[i] ?? false;
                  const isHour = i > 0 && i % 2 === 0;
                  return (
                    <div
                      key={i}
                      role="button"
                      aria-pressed={on}
                      aria-label={`${WEEKDAYS[d]} ${formatHour(slotToMin(i))}`}
                      onMouseDown={() => onCellDown(d, i)}
                      onMouseEnter={() => onCellEnter(d, i)}
                      onTouchStart={(e) => {
                        e.preventDefault();
                        onCellDown(d, i);
                      }}
                      onTouchMove={(e) => {
                        const t = e.touches[0];
                        if (!t) return;
                        const el = document.elementFromPoint(t.clientX, t.clientY);
                        const dd = el?.getAttribute('data-day');
                        const ii = el?.getAttribute('data-slot');
                        if (dd !== null && ii !== null && dd !== undefined && ii !== undefined) {
                          onCellEnter(Number(dd), Number(ii));
                        }
                      }}
                      data-day={d}
                      data-slot={i}
                      className={
                        'h-[14px] cursor-pointer transition-colors ' +
                        (isHour ? 'border-t border-rule/70 ' : '') +
                        (d < 6 ? 'border-r border-rule/70 ' : '') +
                        (on ? 'bg-accent' : 'hover:bg-accent-soft/60')
                      }
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="text-muted italic text-sm mt-2">
          Click or drag to select the times you can attend a live session.
        </p>
      </div>
    </div>
  );
}

function RequiredMark() {
  return (
    <sup
      aria-hidden
      title="required"
      className="text-accent font-sans font-normal text-[0.7em] ml-1 tracking-normal cursor-help"
    >
      ∗
    </sup>
  );
}
