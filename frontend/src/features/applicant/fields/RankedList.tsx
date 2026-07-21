import type { Question } from '@rp2/shared';

type Props = {
  question: Question & { type: 'ranked' };
  value: unknown;
  disabled?: boolean | undefined;
  onSave: (value: unknown) => void;
};

function parseValue(v: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((k): k is string => typeof k === 'string' && allowed.includes(k))
    .filter((k, i, arr) => arr.indexOf(k) === i);
}

export function RankedList({ question, value, disabled, onSave }: Props) {
  const allKeys = question.options.map((o) => o.value);
  const ranked = parseValue(value, allKeys);
  const rankedSet = new Set(ranked);
  const unranked = question.options.filter((o) => !rankedSet.has(o.value));

  function move(index: number, delta: number) {
    const j = index + delta;
    if (j < 0 || j >= ranked.length) return;
    const next = ranked.slice();
    const removed = next.splice(index, 1)[0];
    if (removed === undefined) return;
    next.splice(j, 0, removed);
    onSave(next);
  }

  function include(key: string) {
    onSave([...ranked, key]);
  }

  function exclude(key: string) {
    onSave(ranked.filter((k) => k !== key));
  }

  return (
    <div className="mb-8">
      <div className="block text-ink leading-snug">
        {question.prompt}
        {question.required && <RequiredMark />}
      </div>
      {question.help && (
        <div className="block text-muted text-sm italic mt-1">{question.help}</div>
      )}

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <section aria-labelledby={`${question.key}-ranked`}>
          <h3
            id={`${question.key}-ranked`}
            className="smallcaps text-muted mb-2"
          >
            Your ranked list
          </h3>
          {ranked.length === 0 ? (
            <p className="text-muted italic text-sm">
              No courses ranked yet. Add courses from the right side.
            </p>
          ) : (
            <ol className="space-y-2">
              {ranked.map((key, i) => {
                const opt = question.options.find((o) => o.value === key);
                if (!opt) return null;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-3 bg-white border border-rule px-3 py-2"
                  >
                    <span className="text-accent font-serif italic tabular-nums w-6">
                      {i + 1}.
                    </span>
                    <span className="flex-1 text-ink">{opt.label}</span>
                    <div className="flex gap-1">
                      <IconButton
                        label="Move up"
                        onClick={() => move(i, -1)}
                        disabled={disabled || i === 0}
                      >
                        ↑
                      </IconButton>
                      <IconButton
                        label="Move down"
                        onClick={() => move(i, +1)}
                        disabled={disabled || i === ranked.length - 1}
                      >
                        ↓
                      </IconButton>
                      <IconButton
                        label="Remove"
                        onClick={() => exclude(key)}
                        disabled={disabled}
                      >
                        ✕
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section aria-labelledby={`${question.key}-unranked`}>
          <h3
            id={`${question.key}-unranked`}
            className="smallcaps text-muted mb-2"
          >
            Not interested / not ranked yet
          </h3>
          {unranked.length === 0 ? (
            <p className="text-muted italic text-sm">
              Every course is in your ranked list.
            </p>
          ) : (
            <ul className="space-y-2">
              {unranked.map((opt) => (
                <li
                  key={opt.value}
                  className="flex items-center gap-3 border border-dashed border-rule px-3 py-2"
                >
                  <span className="flex-1 text-ink/80">{opt.label}</span>
                  <button
                    type="button"
                    className="text-accent hover:underline text-sm"
                    onClick={() => include(opt.value)}
                    disabled={disabled}
                  >
                    Add ↩
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 flex items-center justify-center border border-rule bg-white hover:border-ink hover:bg-accent-soft disabled:opacity-30 disabled:cursor-not-allowed text-ink"
    >
      {children}
    </button>
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
