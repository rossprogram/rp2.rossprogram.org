import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';

export function PageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <TopNav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

function TopNav() {
  return (
    <header className="rule-b">
      <div className="max-w-5xl mx-auto px-6 py-5 flex items-baseline justify-between">
        <Link to="/" className="no-underline hover:no-underline" aria-label="ℝℙ² home">
          <span className="font-serif text-[1.75rem] leading-none tracking-tight">
            ℝℙ²
          </span>
        </Link>
        <nav className="smallcaps text-muted flex gap-6">
          <span aria-hidden>— online mathematics —</span>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="rule-t mt-20">
      <div className="max-w-5xl mx-auto px-6 py-6 text-muted text-sm flex justify-between">
        <span>© {new Date().getFullYear()}, Ross Mathematics Foundation</span>
        <span className="italic">rp2 · pilot 2026</span>
      </div>
    </footer>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="prose-mm mx-auto px-6 py-12">{children}</div>;
}

export function SectionHeading({
  number,
  children,
}: {
  number?: number;
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-baseline gap-4">
      {number !== undefined && (
        <span className="text-accent font-serif italic">§{number}</span>
      )}
      <span>{children}</span>
    </h2>
  );
}
