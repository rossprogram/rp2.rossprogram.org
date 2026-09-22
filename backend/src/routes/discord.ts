import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { courseLabel } from '@rp2/shared';
import { eq } from 'drizzle-orm';
import { env } from '../env.js';
import { requireAuth } from '../auth/session.js';
import { db } from '../db/client.js';
import { application, guardianContact, guardianLink, offer, user } from '../db/schema.js';
import {
  authorizeUrl,
  discordEnabled,
  exchangeCode,
  verifyInteraction,
} from '../integrations/discord/index.js';
import { applicationIdForApplicant, isCleared } from '../services/agreements.js';
import {
  applicationForDiscordUser,
  saveLink,
  syncMember,
} from '../services/discord-sync.js';
import { studentNamesFor } from '../services/names.js';

/*
 * Discord: linking an account, and answering slash commands.
 *
 * No invite link is ever minted. A cleared student authorizes us with the
 * `guilds.join` scope and the backend puts them in the guild itself, already
 * named and already roled — so there is no URL that could be forwarded to
 * someone who is not in the program.
 */

/** OAuth state, short-lived, in memory. One process, so a Map is enough. */
const pendingStates = new Map<string, { userId: string; expires: number }>();

function rememberState(userId: string): string {
  const state = randomBytes(24).toString('base64url');
  pendingStates.set(state, { userId, expires: Date.now() + 10 * 60 * 1000 });
  // Opportunistic sweep — this map only ever holds a few entries.
  for (const [k, v] of pendingStates) if (v.expires < Date.now()) pendingStates.delete(k);
  return state;
}

function takeState(state: string): string | null {
  const hit = pendingStates.get(state);
  if (!hit) return null;
  pendingStates.delete(state);
  if (hit.expires < Date.now()) return null;
  return hit.userId;
}

function redirectUri(): string {
  return `${env.APP_URL}/api/discord/callback`;
}

/* ==================== /whois ==================== */

type InteractionData = {
  type: number;
  data?: { name?: string; options?: { name: string; value: unknown }[] };
  member?: { user?: { id?: string }; roles?: string[] };
  user?: { id?: string };
};

const EPHEMERAL = 64;

function reply(content: string) {
  return { type: 4, data: { content, flags: EPHEMERAL } };
}

/**
 * Is the caller staff?
 *
 * Staff are not portal users — they are assigned their Discord roles by hand —
 * so holding the configured staff role is the only signal available, and it is
 * the right one: it is administered by the same people who run the server.
 */
function callerIsStaff(interaction: InteractionData): boolean {
  const staffRole = env.DISCORD_STAFF_ROLE_ID;
  if (!staffRole) return false;
  return (interaction.member?.roles ?? []).includes(staffRole);
}

/**
 * Build the /whois answer.
 *
 * Two tiers. Everyone may learn who they are talking to and which section they
 * are in — that is the point of the command. Only staff see contact details,
 * because handing one minor another minor's email address is not something a
 * chat command should do.
 */
function whoisResponse(targetDiscordId: string, staff: boolean): string {
  const found = applicationForDiscordUser(targetDiscordId);
  if (!found) {
    return staff
      ? 'No linked portal account. They may be staff, or not yet linked.'
      : 'That member is not a linked student — probably a member of staff.';
  }

  const names = studentNamesFor(found.applicationId);
  const o = db.select().from(offer).where(eq(offer.applicationId, found.applicationId)).get();

  const display =
    names.preferred && names.legal && names.preferred.toLowerCase() !== names.legal.toLowerCase()
      ? `${names.preferred} (${names.legal})`
      : (names.legal ?? names.preferred ?? 'Unknown');

  const lines = [`**${display}**`];
  const place = [courseLabel(o?.courseKey), o?.section, o?.cohort ? `Group ${o.cohort}` : null]
    .filter(Boolean)
    .join(' · ');
  if (place) lines.push(place);
  lines.push('Student');

  if (!staff) return lines.join('\n');

  const app = db
    .select({ status: application.status, applicantUserId: application.applicantUserId })
    .from(application)
    .where(eq(application.id, found.applicationId))
    .get();

  lines.push('', `Portal: ${found.email}`);

  if (app) {
    const g = db
      .select({ email: user.email })
      .from(guardianLink)
      .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
      .where(eq(guardianLink.applicantUserId, app.applicantUserId))
      .get();
    const contact = db
      .select()
      .from(guardianContact)
      .where(eq(guardianContact.applicationId, found.applicationId))
      .get();

    const guardianBits = [g?.email, contact?.phone, contact?.altPhone].filter(Boolean);
    if (guardianBits.length > 0) lines.push(`Guardian: ${guardianBits.join(' · ')}`);
    lines.push(`Status: ${app.status}`);
  }
  return lines.join('\n');
}

export async function registerDiscordRoutes(app: FastifyInstance): Promise<void> {
  /* -------- linking -------- */

  app.get('/api/discord/link', { preHandler: requireAuth() }, async (req, reply) => {
    if (!discordEnabled()) return reply.code(503).send({ error: 'discord_disabled' });

    const appId = applicationIdForApplicant(req.currentUser!.id);
    if (!appId) return reply.code(404).send({ error: 'no_application' });
    // The gate. Enrolled AND fully signed, checked here rather than trusted
    // from the page that rendered the button.
    if (!isCleared(appId)) return reply.code(403).send({ error: 'not_cleared' });

    return reply.redirect(authorizeUrl(rememberState(req.currentUser!.id), redirectUri()));
  });

  app.get('/api/discord/callback', { preHandler: requireAuth() }, async (req, reply) => {
    if (!discordEnabled()) return reply.code(503).send({ error: 'discord_disabled' });

    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) return reply.redirect(`${env.APP_URL}/agreements?discord=failed`);

    const stateUserId = takeState(state);
    // A state that does not match this session is either stale or forged.
    if (!stateUserId || stateUserId !== req.currentUser!.id) {
      return reply.redirect(`${env.APP_URL}/agreements?discord=state`);
    }

    const appId = applicationIdForApplicant(req.currentUser!.id);
    if (!appId || !isCleared(appId)) {
      return reply.redirect(`${env.APP_URL}/agreements?discord=not_cleared`);
    }

    try {
      const account = await exchangeCode(code, redirectUri());
      const result = saveLink({
        userId: req.currentUser!.id,
        discordUserId: account.discordUserId,
        username: account.username,
      });
      if (result === 'taken') {
        return reply.redirect(`${env.APP_URL}/agreements?discord=taken`);
      }

      /*
       * Report what actually happened. Redirecting to "joined" regardless of
       * the outcome told nine students they were in a server they had never
       * been added to, and gave them no way to notice or retry.
       */
      const outcome = await syncMember(appId, { accessToken: account.accessToken });
      if (outcome.status === 'skipped') {
        req.log.error(
          { applicationId: appId, reason: outcome.reason },
          'discord link succeeded but the guild join did not',
        );
        return reply.redirect(`${env.APP_URL}/agreements?discord=not_joined`);
      }
      return reply.redirect(`${env.APP_URL}/agreements?discord=joined`);
    } catch (err) {
      req.log.error({ err }, 'discord link failed');
      return reply.redirect(`${env.APP_URL}/agreements?discord=error`);
    }
  });

  /* -------- interactions -------- */

  // Encapsulated scope, exactly as the Stripe webhook does it: the raw bytes
  // are what the signature covers, and the global JSON parser would have
  // already turned them into an object.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    );

    scope.post(
      '/api/discord/interactions',
      // Signature-gated, and Discord pings in bursts when you save the URL.
      { config: { rateLimit: false } },
      async (req, replyTo) => {
        if (!discordEnabled()) return replyTo.code(503).send({ error: 'discord_disabled' });

        const sig = req.headers['x-signature-ed25519'];
        const ts = req.headers['x-signature-timestamp'];
        if (typeof sig !== 'string' || typeof ts !== 'string') {
          return replyTo.code(401).send({ error: 'missing_signature' });
        }
        if (!Buffer.isBuffer(req.body)) {
          return replyTo.code(400).send({ error: 'expected_raw_body' });
        }
        // Discord requires 401 specifically for a bad signature, and checks
        // this when you save the endpoint URL in the dashboard.
        if (!verifyInteraction(req.body, sig, ts)) {
          return replyTo.code(401).send({ error: 'bad_signature' });
        }

        let interaction: InteractionData;
        try {
          interaction = JSON.parse(req.body.toString('utf8')) as InteractionData;
        } catch {
          return replyTo.code(400).send({ error: 'bad_json' });
        }

        // PING -> PONG. This is what the dashboard's "Save" sends.
        if (interaction.type === 1) return { type: 1 };

        if (interaction.type === 2 && interaction.data?.name === 'whois') {
          const option = interaction.data.options?.find((o) => o.name === 'member');
          const target = typeof option?.value === 'string' ? option.value : null;
          if (!target) return reply('Usage: /whois <member>');
          return reply(whoisResponse(target, callerIsStaff(interaction)));
        }

        // Anything else: acknowledge rather than error, so an unknown command
        // does not show the caller a red failure.
        return reply('That command is not available here.');
      },
    );
  });
}
