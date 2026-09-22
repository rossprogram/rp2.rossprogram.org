import { createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';
import { env } from '../../env.js';

/*
 * Discord, behind a narrow interface.
 *
 * There is no gateway connection and no discord.js. Everything the program
 * needs is plain HTTP:
 *
 *   - joining      OAuth2 `guilds.join` + PUT /guilds/{g}/members/{u}
 *   - roles        PUT/DELETE /guilds/{g}/members/{u}/roles/{r}
 *   - nicknames    PATCH /guilds/{g}/members/{u}
 *   - /whois       HTTP Interactions, signature-verified like a webhook
 *
 * We never need a gateway event because we add members ourselves rather than
 * waiting to notice them arrive. That keeps the deployment at one process.
 *
 * Route handlers never import from here directly for anything but the
 * verifier — business logic lives in services/discord-sync.ts.
 */

const API = 'https://discord.com/api/v10';

export function discordEnabled(): boolean {
  return env.DISCORD_ENABLED;
}

export class DiscordError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordError';
  }
}

function config() {
  const {
    DISCORD_CLIENT_ID: clientId,
    DISCORD_CLIENT_SECRET: clientSecret,
    DISCORD_BOT_TOKEN: botToken,
    DISCORD_GUILD_ID: guildId,
    DISCORD_PUBLIC_KEY: publicKey,
  } = env;
  if (!clientId || !clientSecret || !botToken || !guildId || !publicKey) {
    // env.ts refuses to boot in this state when DISCORD_ENABLED=true, so
    // reaching here means someone called in with the feature switched off.
    throw new DiscordError(503, 'not_configured', 'Discord is not configured.');
  }
  return { clientId, clientSecret, botToken, guildId, publicKey };
}

/* ==================== REST ==================== */

type Json = Record<string, unknown>;

/**
 * One call against the Discord REST API, as the bot.
 *
 * Handles 429 by honouring `retry_after` once. Discord's per-route buckets are
 * generous relative to a 192-student cohort, but a reconcile run is the one
 * place we issue a few hundred calls in a row, and a silent failure there
 * leaves a student without a role.
 */
async function rest(
  method: string,
  path: string,
  body?: Json,
  retriesLeft = 1,
): Promise<{ status: number; json: unknown }> {
  const { botToken } = config();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bot ${botToken}`,
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 429 && retriesLeft > 0) {
    const payload = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.ceil((payload.retry_after ?? 1) * 1000);
    await new Promise((r) => setTimeout(r, waitMs));
    return rest(method, path, body, retriesLeft - 1);
  }

  // 204 No Content is a success with nothing to parse.
  const json = res.status === 204 ? null : await res.json().catch(() => null);

  if (res.status >= 400) {
    const detail =
      json && typeof json === 'object' && 'message' in json
        ? String((json as { message: unknown }).message)
        : res.statusText;
    throw new DiscordError(res.status, 'discord_error', `${method} ${path}: ${detail}`);
  }
  return { status: res.status, json };
}

/* ==================== OAuth ==================== */

export function authorizeUrl(state: string, redirectUri: string): string {
  const { clientId } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    // identify: who they are. guilds.join: lets us put them in the server
    // ourselves, so no invite link ever has to exist.
    scope: 'identify guilds.join',
    state,
    redirect_uri: redirectUri,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export type ExchangedAccount = {
  accessToken: string;
  discordUserId: string;
  username: string;
};

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<ExchangedAccount> {
  const { clientId, clientSecret } = config();

  const tokenRes = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    throw new DiscordError(400, 'oauth_failed', 'Discord rejected the authorization code.');
  }
  const token = (await tokenRes.json()) as { access_token?: string };
  if (!token.access_token) {
    throw new DiscordError(400, 'oauth_failed', 'Discord returned no access token.');
  }

  const meRes = await fetch(`${API}/users/@me`, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) {
    throw new DiscordError(400, 'oauth_failed', 'Could not read the Discord account.');
  }
  const me = (await meRes.json()) as { id?: string; username?: string };
  if (!me.id) {
    throw new DiscordError(400, 'oauth_failed', 'Discord returned no account id.');
  }

  return {
    accessToken: token.access_token,
    discordUserId: me.id,
    username: me.username ?? '',
  };
}

/* ==================== members ==================== */

export type AddMemberInput = {
  discordUserId: string;
  accessToken: string;
  nick: string;
  roleIds: string[];
};

/**
 * Put a student in the guild, already named and already roled.
 *
 * Discord answers 201 when it adds them and 204 when they were already a
 * member — and in the 204 case it applies NOTHING from this request. The
 * caller must follow up with setMemberNickname/setMemberRoles, which is why
 * this reports which happened instead of returning void.
 */
export async function addGuildMember(input: AddMemberInput): Promise<'added' | 'already_member'> {
  const { guildId } = config();
  const { status } = await rest('PUT', `/guilds/${guildId}/members/${input.discordUserId}`, {
    access_token: input.accessToken,
    nick: input.nick,
    roles: input.roleIds,
  });
  return status === 201 ? 'added' : 'already_member';
}

export async function setMemberNickname(discordUserId: string, nick: string): Promise<void> {
  const { guildId } = config();
  await rest('PATCH', `/guilds/${guildId}/members/${discordUserId}`, { nick });
}

export async function addMemberRole(discordUserId: string, roleId: string): Promise<void> {
  const { guildId } = config();
  await rest('PUT', `/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`);
}

export async function removeMemberRole(discordUserId: string, roleId: string): Promise<void> {
  const { guildId } = config();
  await rest('DELETE', `/guilds/${guildId}/members/${discordUserId}/roles/${roleId}`);
}

export type GuildMember = {
  discordUserId: string;
  nick: string | null;
  roleIds: string[];
};

export async function getMember(discordUserId: string): Promise<GuildMember | null> {
  const { guildId } = config();
  try {
    const { json } = await rest('GET', `/guilds/${guildId}/members/${discordUserId}`);
    const m = json as { nick?: string | null; roles?: string[] };
    return { discordUserId, nick: m.nick ?? null, roleIds: m.roles ?? [] };
  } catch (err) {
    if (err instanceof DiscordError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Remove a student from the guild entirely.
 *
 * Stripping roles is not enough: a member with no roles can still read
 * anything @everyone can. The participation agreement says access "will end
 * immediately", so it ends.
 */
export async function removeGuildMember(discordUserId: string): Promise<void> {
  const { guildId } = config();
  try {
    await rest('DELETE', `/guilds/${guildId}/members/${discordUserId}`);
  } catch (err) {
    // Already gone is the desired state, not a failure.
    if (err instanceof DiscordError && err.status === 404) return;
    throw err;
  }
}

/* ==================== roles ==================== */

export type GuildRole = { id: string; name: string; position: number; managed: boolean };

export async function listGuildRoles(): Promise<GuildRole[]> {
  const { guildId } = config();
  const { json } = await rest('GET', `/guilds/${guildId}/roles`);
  const rows = (json ?? []) as { id: string; name: string; position: number; managed?: boolean }[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    position: r.position,
    managed: r.managed ?? false,
  }));
}

export async function createGuildRole(name: string): Promise<{ id: string }> {
  const { guildId } = config();
  const { json } = await rest('POST', `/guilds/${guildId}/roles`, {
    name,
    // No extra permissions: a section role is for visibility and mentions.
    // Channel access is granted per channel in the server settings.
    permissions: '0',
    mentionable: true,
  });
  const r = json as { id?: string };
  if (!r.id) throw new DiscordError(502, 'no_role_id', 'Discord created a role with no id.');
  return { id: r.id };
}

/* ==================== interactions ==================== */

/**
 * Interaction signatures are Ed25519 over (timestamp + raw body).
 *
 * Discord publishes the public key as 64 hex characters — a bare 32-byte
 * key, which node:crypto will not load. Wrapping it in the fixed 12-byte SPKI
 * header below produces a DER document `createPublicKey` accepts, which is
 * why this needs no npm package. Verified against Node 20 on the host.
 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Reject anything older than this, so a captured request cannot be replayed. */
const MAX_INTERACTION_AGE_SECONDS = 5 * 60;

export function verifyInteraction(
  rawBody: Buffer,
  signatureHex: string,
  timestamp: string,
): boolean {
  const { publicKey } = config();

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_INTERACTION_AGE_SECONDS) return false;

  let signature: Buffer;
  try {
    signature = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;

  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), rawBody]);
    return cryptoVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

/** Constant-time compare, for anything secret we match by value. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
