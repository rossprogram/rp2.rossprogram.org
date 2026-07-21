import { useEffect, useRef, useState } from 'react';
import type { Question } from '@rp2/shared';
import { isRenderable } from '@rp2/shared';

type Props = {
  question: Question;
  value: unknown;
  disabled?: boolean | undefined;
  onSave: (value: unknown) => void;
};

export function Field({ question, value, disabled, onSave }: Props) {
  if (!isRenderable(question)) return <ComingSoon question={question} />;

  switch (question.type) {
    case 'short_text':
    case 'email':
    case 'phone':
      return (
        <TextInput
          question={question}
          value={value}
          disabled={disabled}
          onSave={onSave}
          type={question.type === 'email' ? 'email' : question.type === 'phone' ? 'tel' : 'text'}
        />
      );
    case 'date':
      return <TextInput question={question} value={value} disabled={disabled} onSave={onSave} type="date" />;
    case 'long_text':
      return <LongText question={question} value={value} disabled={disabled} onSave={onSave} />;
    case 'single_select':
      return <SingleSelect question={question} value={value} disabled={disabled} onSave={onSave} />;
    case 'multi_select':
      return <MultiSelect question={question} value={value} disabled={disabled} onSave={onSave} />;
    default:
      return null;
  }
}

function Wrapper({
  question,
  children,
}: {
  question: Question;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <label className="block">
        <span className="block text-ink leading-snug">
          {question.prompt}
          {question.required && <RequiredMark />}
        </span>
        {question.help && (
          <span className="block text-muted text-sm italic mt-1">{question.help}</span>
        )}
        <div className="mt-3">{children}</div>
      </label>
    </div>
  );
}

export function RequiredMark() {
  return (
    <sup
      aria-hidden
      className="text-accent font-sans font-normal text-[0.7em] ml-1 tracking-normal"
    >
      ∗
    </sup>
  );
}

function TextInput({
  question,
  value,
  disabled,
  onSave,
  type,
}: Props & { type: 'text' | 'email' | 'tel' | 'date' }) {
  const [local, setLocal] = useState(stringify(value));
  useEffect(() => {
    setLocal(stringify(value));
  }, [value]);
  return (
    <Wrapper question={question}>
      <input
        type={type}
        className="field-input"
        value={local}
        disabled={disabled}
        maxLength={
          question.type === 'short_text' ? question.maxLength ?? undefined : undefined
        }
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          if (local !== stringify(value)) onSave(local);
        }}
      />
    </Wrapper>
  );
}

function LongText({ question, value, disabled, onSave }: Props) {
  const [local, setLocal] = useState(stringify(value));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setLocal(stringify(value));
  }, [value]);
  useEffect(() => {
    autosize(ref.current);
  }, [local]);
  return (
    <Wrapper question={question}>
      <textarea
        ref={ref}
        className="field-input font-serif leading-relaxed py-3"
        rows={4}
        value={local}
        disabled={disabled}
        onChange={(e) => {
          setLocal(e.target.value);
        }}
        onBlur={() => {
          if (local !== stringify(value)) onSave(local);
        }}
      />
      <div className="text-muted text-xs mt-1 flex justify-end tabular-nums">
        {wordCount(local)} {wordCount(local) === 1 ? 'word' : 'words'}
      </div>
    </Wrapper>
  );
}

function SingleSelect({ question, value, disabled, onSave }: Props) {
  if (question.type !== 'single_select') return null;
  const selected = stringify(value);
  return (
    <Wrapper question={question}>
      <div className="space-y-2 mt-1">
        {question.options.map((opt) => (
          <label
            key={opt.value}
            className="flex items-baseline gap-3 cursor-pointer group"
          >
            <input
              type="radio"
              name={question.key}
              value={opt.value}
              checked={selected === opt.value}
              disabled={disabled}
              onChange={() => onSave(opt.value)}
              className="accent-accent shrink-0 translate-y-[2px]"
            />
            <span className="group-hover:text-ink text-ink/95">{opt.label}</span>
          </label>
        ))}
      </div>
    </Wrapper>
  );
}

function MultiSelect({ question, value, disabled, onSave }: Props) {
  if (question.type !== 'multi_select') return null;
  const current = Array.isArray(value) ? (value as string[]) : [];
  return (
    <Wrapper question={question}>
      <div className="space-y-2 mt-1">
        {question.options.map((opt) => {
          const checked = current.includes(opt.value);
          return (
            <label
              key={opt.value}
              className="flex items-baseline gap-3 cursor-pointer group"
            >
              <input
                type="checkbox"
                value={opt.value}
                checked={checked}
                disabled={disabled}
                onChange={() => {
                  const next = checked
                    ? current.filter((v) => v !== opt.value)
                    : [...current, opt.value];
                  onSave(next);
                }}
                className="accent-accent shrink-0 translate-y-[2px]"
              />
              <span className="group-hover:text-ink text-ink/95">{opt.label}</span>
            </label>
          );
        })}
      </div>
    </Wrapper>
  );
}

function ComingSoon({ question }: { question: Question }) {
  return (
    <Wrapper question={question}>
      <div className="border border-dashed border-rule text-muted italic px-4 py-3 text-sm">
        This question needs a <span className="not-italic font-sans">{humanType(question.type)}</span>{' '}
        input. Coming in the next iteration — you'll be able to fill it in
        before you submit.
      </div>
    </Wrapper>
  );
}

function humanType(t: Question['type']): string {
  switch (t) {
    case 'availability_grid':
      return 'availability grid';
    case 'file_upload':
      return 'file upload';
    case 'ranked':
      return 'drag-to-rank';
    case 'signature':
      return 'signature';
    default:
      return t;
  }
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  return String(v);
}

function wordCount(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function autosize(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
