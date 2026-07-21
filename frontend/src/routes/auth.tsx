import { useState } from 'react';
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
