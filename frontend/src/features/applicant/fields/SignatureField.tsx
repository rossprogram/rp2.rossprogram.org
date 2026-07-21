import { useState, useEffect } from 'react';
import type { Question } from '@rp2/shared';

type SignatureValue = { typed: string; at: string };

type Props = {
  question: Question & { type: 'signature' };
  value: unknown;
  disabled?: boolean | undefined;
  onSave: (value: unknown) => void;
};

function parseValue(v: unknown): SignatureValue | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.typed !== 'string' || typeof o.at !== 'string') return null;
  return { typed: o.typed, at: o.at };
}

export function SignatureField({ question, value, disabled, onSave }: Props) {
  const initial = parseValue(value);
  const [typed, setTyped] = useState(initial?.typed ?? '');
  useEffect(() => {
    const p = parseValue(value);
    setTyped(p?.typed ?? '');
  }, [value]);

  const savedAt = initial?.at ?? null;

  function commit(nextTyped: string) {
    const trimmed = nextTyped.trim();
    if (trimmed.length === 0) {
      onSave(null);
      return;
    }
    onSave({ typed: trimmed, at: new Date().toISOString() });
  }

  return (
    <div className="mb-8">
      <label className="block">
        <span className="block text-ink leading-snug">
          {question.prompt}
          {question.required && <RequiredMark />}
        </span>
        <span className="block text-muted text-sm italic mt-1">
          Typing your name below acts as an electronic signature. It records
          your name and the moment you signed.
        </span>
        <input
          type="text"
          className="field-input mt-3 font-serif italic text-lg"
          value={typed}
          disabled={disabled}
          placeholder="Type your full name"
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => {
            const p = parseValue(value);
            if (typed.trim() !== (p?.typed ?? '')) commit(typed);
          }}
        />
        {savedAt && (
          <span className="block text-muted text-sm italic mt-2">
            Signed {formatSignedAt(savedAt)}
          </span>
        )}
      </label>
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

function formatSignedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}
