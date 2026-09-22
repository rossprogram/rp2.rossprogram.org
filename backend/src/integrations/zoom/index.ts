import { env } from '../../env.js';

/*
 * Zoom, behind a narrow interface.
 *
 * Server-to-server OAuth: the account's own credentials are exchanged for a
 * one-hour bearer token, with no user consent step. Same shape as the Discord
 * module — a config() guard, hand-rolled DTOs, one private rest() helper —
 * plus token caching, which Discord does not need because a bot token never
 * expires.
 *
 * Route handlers never import this directly; services do.
 */

const API = 'https://api.zoom.us/v2';
const TOKEN_URL = 'https://zoom.us/oauth/token';

export function zoomEnabled(): boolean {
  return env.ZOOM_ENABLED;
}

export class ZoomError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ZoomError';
  }
}

function config() {
  const {
    ZOOM_ACCOUNT_ID: accountId,
    ZOOM_CLIENT_ID: clientId,
    ZOOM_CLIENT_SECRET: clientSecret,
  } = env;
  if (!accountId || !clientId || !clientSecret) {
    throw new ZoomError(503, 'not_configured', 'Zoom is not configured.');
  }
  return { accountId, clientId, clientSecret };
}

/* ==================== auth ==================== */

let cached: { token: string; expiresAt: number } | null = null;

/**
 * A bearer token, minted on demand and reused until shortly before it lapses.
 *
 * Zoom's tokens last an hour; the 60-second margin keeps a long reconcile
 * from failing on a token that expired mid-run.
 */
async function token(): Promise<string> {
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs + 60_000) return cached.token;

  const { accountId, clientId, clientSecret } = config();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(
    `${TOKEN_URL}?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`,
    { method: 'POST', headers: { authorization: `Basic ${basic}` } },
  );
  if (!res.ok) {
    throw new ZoomError(res.status, 'token_failed', `Zoom refused the credentials: ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new ZoomError(502, 'token_failed', 'Zoom returned no access token.');

  cached = {
    token: body.access_token,
    expiresAt: nowMs + (body.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

/* ==================== REST ==================== */

async function rest(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  retriesLeft = 1,
): Promise<{ status: number; json: unknown }> {
  const bearer = await token();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // Zoom rate-limits per endpoint category and answers 429 with Retry-After.
  if (res.status === 429 && retriesLeft > 0) {
    const wait = Number(res.headers.get('retry-after') ?? 1);
    await new Promise((r) => setTimeout(r, Math.max(1, wait) * 1000));
    return rest(method, path, body, retriesLeft - 1);
  }

  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status >= 400) {
    const detail =
      json && typeof json === 'object' && 'message' in json
        ? String((json as { message: unknown }).message)
        : res.statusText;
    throw new ZoomError(res.status, 'zoom_error', `${method} ${path}: ${detail}`);
  }
  return { status: res.status, json };
}

/* ==================== users ==================== */

export type ZoomUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** 1 = Basic (no licence), 2 = Licensed, 3 = On-prem. */
  type: number;
  status: string;
  createdAt: string | null;
  lastLoginAt: string | null;
};

/** Every user on the account, following pagination to the end. */
export async function listUsers(status: 'active' | 'inactive' | 'pending' = 'active'): Promise<ZoomUser[]> {
  const out: ZoomUser[] = [];
  let pageToken = '';

  do {
    const qs = new URLSearchParams({ status, page_size: '300' });
    if (pageToken) qs.set('next_page_token', pageToken);
    const { json } = await rest('GET', `/users?${qs.toString()}`);
    const body = json as {
      users?: {
        id: string;
        email: string;
        first_name?: string;
        last_name?: string;
        type: number;
        status: string;
        created_at?: string;
        last_login_time?: string;
      }[];
      next_page_token?: string;
    };
    for (const u of body.users ?? []) {
      out.push({
        id: u.id,
        email: u.email,
        firstName: u.first_name ?? '',
        lastName: u.last_name ?? '',
        type: u.type,
        status: u.status,
        createdAt: u.created_at ?? null,
        lastLoginAt: u.last_login_time ?? null,
      });
    }
    pageToken = body.next_page_token ?? '';
  } while (pageToken);

  return out;
}

/**
 * How many cloud recordings a user owns, across the window Zoom will report.
 *
 * Deleting a user takes their recordings with them, so nothing should be
 * removed before this has been asked — especially for a program whose
 * sessions involve minors.
 */
export async function countRecordings(
  userId: string,
  from: string,
  to: string,
): Promise<number | null> {
  try {
    const qs = new URLSearchParams({ from, to, page_size: '300' });
    const { json } = await rest('GET', `/users/${encodeURIComponent(userId)}/recordings?${qs.toString()}`);
    const body = json as { total_records?: number };
    return body.total_records ?? 0;
  } catch (err) {
    /*
     * NULL means "we could not find out", never "there are none".
     *
     * This originally returned 0 on any 4xx, and with the recording scope
     * missing every call 400'd — so an audit of 196 accounts reported that
     * not one of them had a recording. An unverified assumption dressed as a
     * measurement is worse than no measurement, because someone acts on it.
     */
    if (err instanceof ZoomError && err.status === 404) return 0;
    if (err instanceof ZoomError && err.status >= 400) return null;
    throw err;
  }
}

/**
 * Remove a user from the account.
 *
 * `disassociate` detaches them, leaving them a free personal account and
 * their own data. `delete` is permanent. Disassociation is the right default
 * for people who merely no longer belong here.
 */
export async function removeUser(
  userId: string,
  action: 'disassociate' | 'delete',
): Promise<void> {
  await rest('DELETE', `/users/${encodeURIComponent(userId)}?action=${action}`);
}
