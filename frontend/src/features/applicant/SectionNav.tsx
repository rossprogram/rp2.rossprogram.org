import { Link } from '@tanstack/react-router';
import type { Question, SectionKey } from '@rp2/shared';
import { SECTIONS, QUESTIONS, isRenderable } from '@rp2/shared';
import type { ApplicationFile } from '../../api/client';

type Props = {
  responses: Record<string, unknown>;
  files: readonly ApplicationFile[];
  currentSection?: SectionKey;
};

export function SectionNav({ responses, files, currentSection }: Props) {
  return (
    <nav aria-label="Application sections" className="text-sm">
      <ol className="space-y-1">
        {SECTIONS.map((s) => {
          const progress = sectionProgress(s.key, responses, files);
          const active = s.key === currentSection;
          return (
            <li key={s.key}>
              <Link
                to="/apply/$section"
                params={{ section: s.slug }}
                className={
                  'block no-underline hover:no-underline rounded-sm px-3 py-2 -mx-3 transition-colors ' +
                  (active
                    ? 'bg-accent-soft text-ink'
                    : 'text-ink hover:bg-accent-soft/60')
                }
              >
                <div className="flex items-baseline gap-3">
                  <span className="text-accent font-serif italic tabular-nums w-6">
                    §{s.index}
                  </span>
                  <span className="flex-1">{s.title}</span>
                  <ProgressDot state={progress} />
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type Progress = 'empty' | 'partial' | 'complete';

export function sectionProgress(
  section: SectionKey,
  responses: Record<string, unknown>,
  files: readonly ApplicationFile[],
): Progress {
  const renderable = QUESTIONS.filter(
    (q) => q.section === section && isRenderable(q),
  );
  if (renderable.length === 0) return 'empty';
  const requiredRenderable = renderable.filter((q) => q.required);
  const filledRequired = requiredRenderable.filter((q) =>
    hasAnswer(q, responses, files),
  );
  const anyFilled = renderable.some((q) => hasAnswer(q, responses, files));

  if (
    requiredRenderable.length > 0 &&
    filledRequired.length === requiredRenderable.length
  ) {
    return 'complete';
  }
  if (anyFilled) return 'partial';
  return 'empty';
}

function hasAnswer(
  q: Question,
  responses: Record<string, unknown>,
  files: readonly ApplicationFile[],
): boolean {
  if (q.type === 'file_upload') {
    return files.some((f) => f.kind === q.kind);
  }
  return hasValue(responses[q.key]);
}

function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

function ProgressDot({ state }: { state: Progress }) {
  const label =
    state === 'complete' ? 'complete' : state === 'partial' ? 'in progress' : 'not started';
  return (
    <span
      aria-label={label}
      title={label}
      className={
        'inline-block w-2.5 h-2.5 rounded-full border ' +
        (state === 'complete'
          ? 'bg-accent border-accent'
          : state === 'partial'
            ? 'bg-accent/40 border-accent'
            : 'bg-transparent border-muted/60')
      }
    />
  );
}

export function nextSectionSlug(current: SectionKey): string | null {
  const idx = SECTIONS.findIndex((s) => s.key === current);
  const next = SECTIONS[idx + 1];
  return next ? next.slug : null;
}

export function firstIncompleteSlug(
  responses: Record<string, unknown>,
  files: readonly ApplicationFile[],
): string {
  for (const s of SECTIONS) {
    if (sectionProgress(s.key, responses, files) !== 'complete') return s.slug;
  }
  return SECTIONS[0]!.slug;
}

export function allRenderableRequiredComplete(
  responses: Record<string, unknown>,
  files: readonly ApplicationFile[],
): boolean {
  return QUESTIONS.filter((q: Question) => q.required && isRenderable(q)).every((q) =>
    hasAnswer(q, responses, files),
  );
}
