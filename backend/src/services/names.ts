/*
 * What is this student called?
 *
 * Six places used to answer that question, each with its own query and its own
 * fallback (studentNameFor in payments.ts, hydrateSummary in guardian.ts,
 * notifyTargetsFor and loadOfferEnvelope in offers.ts, listApplications in
 * admin.ts, and an inline query in routes/application.ts). The Discord
 * nickname would have been a seventh, and the one that is most visible when it
 * disagrees with the others.
 *
 * The store is `application_response`, keyed by question — NOT applicant_profile,
 * which is written on every save and read by nothing.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { applicationResponse } from '../db/schema.js';

export type StudentNames = {
  legal: string | null;
  preferred: string | null;
};

const LEGAL_KEY = 'student_legal_name';
const PREFERRED_KEY = 'student_preferred_name';

/**
 * Responses are JSON-encoded, and the applicant's own signature field stores
 * `{ typed, at }` rather than a bare string — so a value that should be a name
 * is sometimes an object. Unwrap both shapes and give up quietly on anything
 * else; a malformed name must never throw in the middle of a role sync.
 */
function readString(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && typeof (v as { typed?: unknown }).typed === 'string') {
    return (v as { typed: string }).typed.trim() || null;
  }
  return null;
}

export function studentNamesFor(applicationId: string): StudentNames {
  const rows = db
    .select({ key: applicationResponse.questionKey, value: applicationResponse.value })
    .from(applicationResponse)
    .where(
      and(
        eq(applicationResponse.applicationId, applicationId),
        inArray(applicationResponse.questionKey, [LEGAL_KEY, PREFERRED_KEY]),
      ),
    )
    .all();

  const pick = (key: string) => readString(rows.find((r) => r.key === key)?.value);
  return { legal: pick(LEGAL_KEY), preferred: pick(PREFERRED_KEY) };
}

/** Batch form, for screens that list many applications. */
export function studentNamesForMany(
  applicationIds: string[],
): Map<string, StudentNames> {
  const out = new Map<string, StudentNames>();
  if (applicationIds.length === 0) return out;

  const rows = db
    .select({
      applicationId: applicationResponse.applicationId,
      key: applicationResponse.questionKey,
      value: applicationResponse.value,
    })
    .from(applicationResponse)
    .where(
      and(
        inArray(applicationResponse.applicationId, applicationIds),
        inArray(applicationResponse.questionKey, [LEGAL_KEY, PREFERRED_KEY]),
      ),
    )
    .all();

  for (const id of applicationIds) out.set(id, { legal: null, preferred: null });
  for (const r of rows) {
    const entry = out.get(r.applicationId);
    if (!entry) continue;
    if (r.key === LEGAL_KEY) entry.legal = readString(r.value);
    else entry.preferred = readString(r.value);
  }
  return out;
}

/** The one-line form: preferred if we have it, else legal. */
export function displayNameFor(applicationId: string): string | null {
  const n = studentNamesFor(applicationId);
  return n.preferred ?? n.legal;
}
