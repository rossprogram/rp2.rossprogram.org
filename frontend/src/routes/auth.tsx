import { useEffect, useState } from 'react';
import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import { api, ApiError } from '../api/client';

function RequestLinkPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = z.string().email().safeParse(email);
    if (!parsed.success) {
      setError('Please enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/api/auth/request-link', { email: parsed.data });
      navigate({ to: '/auth/check-email', search: { email: parsed.data } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many requests. Please wait a minute and try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Sign in</p>
      <h1 className="mb-4">Enter your email</h1>
      <p className="text-muted mb-8">
        We will email you a one-time sign-in link. No password required.
      </p>

      <form onSubmit={onSubmit} className="max-w-md">
        <label className="block">
          <span className="smallcaps text-muted">Email address</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input mt-1"
            placeholder="you@example.com"
            disabled={submitting}
          />
        </label>

        {error && <p className="mt-4 text-accent">{error}</p>}

        <div className="mt-8 flex items-center gap-4">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send sign-in link'}
          </button>
          <Link to="/" className="text-muted no-underline hover:underline">
            Back
          </Link>
        </div>
      </form>
    </Prose>
  );
}

export const authRequestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/request',
  component: RequestLinkPage,
});

const CheckEmailSearch = z.object({ email: z.string().email().optional() });

function CheckEmailPage() {
  const { email } = authCheckEmailRoute.useSearch();
  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Check your inbox</p>
      <h1 className="mb-4">A sign-in link is on its way.</h1>
      <p className="text-lg">
        If an account exists for{' '}
        {email ? <em>{email}</em> : <em>that address</em>}, we&rsquo;ve just sent a
        link that will sign you in.
      </p>
      <p className="text-muted mt-6">
        The link expires in 15 minutes and can only be used once. If you don&rsquo;t
        see the email within a few minutes, check your spam folder.
      </p>
      <div className="mt-10">
        <Link to="/auth/request" className="btn btn-ghost no-underline">
          Use a different email
        </Link>
      </div>
    </Prose>
  );
}

export const authCheckEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/check-email',
  validateSearch: CheckEmailSearch,
  component: CheckEmailPage,
});

const VerifyErrorSearch = z.object({
  error: z.enum(['invalid', 'expired', 'used']).optional(),
});

function VerifyErrorPage() {
  const { error } = authVerifyRoute.useSearch();
  const msg =
    error === 'expired'
      ? 'That sign-in link has expired.'
      : error === 'used'
        ? 'That sign-in link has already been used.'
        : 'That sign-in link is not valid.';
  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Sign-in link problem</p>
      <h1 className="mb-4">{msg}</h1>
      <p className="text-muted mb-8">
        Please request a new one — we&rsquo;ll email it immediately.
      </p>
      <Link to="/auth/request" className="btn btn-primary no-underline">
        Request a new link
      </Link>
    </Prose>
  );
}

export const authVerifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/verify',
  validateSearch: VerifyErrorSearch,
  component: VerifyErrorPage,
});

/* -------- interstitial (scanner-safe consume) -------- */

const CompleteSearch = z.object({ token: z.string().optional() });

type PeekState =
  | { kind: 'loading' }
  | { kind: 'ready'; email: string; needsDob: boolean };

type ConfirmError =
  | 'invalid'
  | 'expired'
  | 'used'
  | 'dob_required'
  | 'invalid_dob'
  | 'too_young'
  | 'unknown';

function CompletePage() {
  const { token } = authCompleteRoute.useSearch();
  const navigate = useNavigate();
  const [peek, setPeek] = useState<PeekState>({ kind: 'loading' });
  const [dob, setDob] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<ConfirmError | null>(null);

  useEffect(() => {
    if (!token) {
      navigate({ to: '/auth/verify', search: { error: 'invalid' } });
      return;
    }
    (async () => {
      try {
        const res = await api.get<{ email: string; expiresAt: number; needsDob: boolean }>(
          `/api/auth/verify/peek?token=${encodeURIComponent(token)}`,
        );
        setPeek({ kind: 'ready', email: res.email, needsDob: res.needsDob });
      } catch (err) {
        const body =
          err instanceof ApiError &&
          typeof err.body === 'object' &&
          err.body !== null &&
          'error' in err.body
            ? (err.body as { error: string }).error
            : 'invalid';
        const reason: 'invalid' | 'expired' | 'used' =
          body === 'expired' ? 'expired' : body === 'used' ? 'used' : 'invalid';
        navigate({ to: '/auth/verify', search: { error: reason } });
      }
    })();
  }, [token, navigate]);

  async function onContinue() {
    if (!token) return;
    if (peek.kind === 'ready' && peek.needsDob && !isValidIsoDate(dob)) {
      setConfirmError('dob_required');
      return;
    }
    setSubmitting(true);
    setConfirmError(null);
    try {
      const body: Record<string, string> = { token };
      if (peek.kind === 'ready' && peek.needsDob) body.dob = dob;
      await api.post('/api/auth/complete', body);
      window.location.assign('/apply');
    } catch (err) {
      if (err instanceof ApiError) {
        const raw =
          typeof err.body === 'object' && err.body !== null && 'error' in err.body
            ? ((err.body as { error: string }).error as string)
            : 'unknown';
        const known: ConfirmError[] = [
          'invalid',
          'expired',
          'used',
          'dob_required',
          'invalid_dob',
          'too_young',
        ];
        setConfirmError(known.includes(raw as ConfirmError) ? (raw as ConfirmError) : 'unknown');
      } else {
        setConfirmError('unknown');
      }
      setSubmitting(false);
    }
  }

  if (peek.kind === 'loading') {
    return (
      <Prose>
        <p className="smallcaps text-accent mb-6">Sign in</p>
        <h1 className="mb-4">Checking your link…</h1>
      </Prose>
    );
  }

  if (confirmError === 'too_young') {
    return (
      <Prose>
        <p className="smallcaps text-accent mb-6">Sorry</p>
        <h1 className="mb-4">ℝℙ² is open to applicants aged 13 and older.</h1>
        <p className="text-muted mb-8">
          We&rsquo;re unable to offer accounts to children under 13. If this was
          a mistake, request a new sign-in link and enter the correct date of
          birth.
        </p>
        <Link to="/auth/request" className="btn btn-primary no-underline">
          Request a new link
        </Link>
      </Prose>
    );
  }

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Confirm sign-in</p>
      <h1 className="mb-4">
        You&rsquo;re about to sign in as <em>{peek.email}</em>.
      </h1>
      <p className="text-muted mb-8 max-w-xl">
        Corporate email scanners sometimes open links before you do. To make
        sure it&rsquo;s really you, click below to complete sign-in.
      </p>

      {peek.needsDob && (
        <div className="mb-8 max-w-md">
          <label className="block">
            <span className="block text-ink leading-snug">
              Date of birth
              <sup
                aria-hidden
                title="required"
                className="text-accent font-sans font-normal text-[0.7em] ml-1 tracking-normal cursor-help"
              >
                ∗
              </sup>
            </span>
            <span className="block text-muted text-sm italic mt-1">
              ℝℙ² is open to applicants aged 13 and older. We store your date of
              birth privately and never share it with reviewers.
            </span>
            <input
              type="date"
              className="field-input font-mono mt-3"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={todayIso()}
              required
            />
          </label>
        </div>
      )}

      {confirmError && (
        <p className="text-accent mb-6">
          {confirmError === 'expired'
            ? 'This link has expired — please request a new one.'
            : confirmError === 'used'
              ? 'This link has already been used — please request a new one.'
              : confirmError === 'invalid'
                ? 'This link is not valid.'
                : confirmError === 'dob_required'
                  ? 'Please enter your date of birth to continue.'
                  : confirmError === 'invalid_dob'
                    ? "That date doesn't look right — please check and try again."
                    : 'Something went wrong. Please try again.'}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          className="btn btn-primary"
          onClick={onContinue}
          disabled={submitting}
          autoFocus={!peek.needsDob}
        >
          {submitting ? 'Signing in…' : 'Continue to my application →'}
        </button>
        <Link to="/auth/request" className="text-muted no-underline hover:underline">
          Cancel
        </Link>
      </div>
    </Prose>
  );
}

function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const authCompleteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth/complete',
  validateSearch: CompleteSearch,
  component: CompletePage,
});
