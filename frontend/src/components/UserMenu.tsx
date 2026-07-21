import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api, fetchMe } from '../api/client';

export function UserMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const me = useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 60_000 });

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (me.isLoading) return null;

  if (!me.data) {
    return (
      <Link
        to="/auth/request"
        className="smallcaps text-muted hover:text-ink no-underline"
      >
        Sign in
      </Link>
    );
  }

  const email = me.data.email;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-baseline gap-2 smallcaps text-muted hover:text-ink transition-colors"
      >
        <span className="font-mono normal-case tracking-normal text-[0.85rem] max-w-[22ch] truncate">
          {email}
        </span>
        <span aria-hidden className="text-[0.7em] translate-y-[-1px]">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 z-20 min-w-[14rem] border border-rule bg-white"
          style={{ boxShadow: '0 4px 12px rgba(15,31,23,0.06)' }}
        >
          <div className="px-4 py-3 border-b border-rule">
            <div className="smallcaps text-muted mb-1">Signed in as</div>
            <div className="font-mono text-sm text-ink truncate">{email}</div>
          </div>
          {me.data.roles.includes('guardian') && (
            <MenuLink to="/guardian" onClick={() => setOpen(false)}>
              Parent portal
            </MenuLink>
          )}
          {!me.data.roles.includes('guardian') && (
            <MenuLink to="/apply" onClick={() => setOpen(false)}>
              My application
            </MenuLink>
          )}
          <button
            role="menuitem"
            className="block w-full text-left px-4 py-2.5 hover:bg-accent-soft text-ink"
            onClick={async () => {
              await api.post('/api/auth/logout');
              window.location.assign('/');
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({
  to,
  children,
  onClick,
}: {
  to: '/apply' | '/guardian';
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      className="block px-4 py-2.5 hover:bg-accent-soft text-ink no-underline"
      onClick={onClick}
    >
      {children}
    </Link>
  );
}
