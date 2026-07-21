import { useEffect, useState } from 'react';

type Props = {
  updatedAt: number | null;
  saving: boolean;
};

export function SavedIndicator({ updatedAt, saving }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (saving) {
    return (
      <span className="smallcaps text-muted animate-pulse" aria-live="polite">
        Saving…
      </span>
    );
  }
  if (!updatedAt) {
    return (
      <span className="smallcaps text-muted italic" aria-live="polite">
        Draft not yet saved
      </span>
    );
  }
  return (
    <span className="smallcaps text-muted" aria-live="polite">
      Draft saved {relativeTime(updatedAt)}
    </span>
  );
}

function relativeTime(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 45) return 'just now';
  if (diff < 90) return 'a minute ago';
  if (diff < 60 * 45) return `${Math.round(diff / 60)} minutes ago`;
  if (diff < 60 * 90) return 'an hour ago';
  if (diff < 60 * 60 * 24) return `${Math.round(diff / 3600)} hours ago`;
  const d = new Date(unixSeconds * 1000);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
