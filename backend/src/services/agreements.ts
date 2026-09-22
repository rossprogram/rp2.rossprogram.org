/*
 * The Code of Conduct and the Program Participation Agreement.
 *
 * Both are signed by BOTH the student and their guardian — four signatures per
 * family — and together with enrollment they are what clears a student to take
 * part. `isCleared()` at the bottom is the single predicate everything else
 * asks; nothing should re-derive it.
 */

import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  AGREEMENTS,
  agreementByKey,
  agreementCanonicalText,
  type AgreementDocument,
  type AgreementKey,
  type SignerKind,
} from '@rp2/shared';
import { db } from '../db/client.js';
import {
  agreementSignature,
  application,
  guardianContact,
  guardianLink,
  user,
} from '../db/schema.js';
import { isEnrolled } from './offers.js';

export class AgreementError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 409,
  ) {
    super(message);
    this.name = 'AgreementError';
  }
}

const now = (): number => Math.floor(Date.now() / 1000);

/**
 * The digest stored on a signature. Derived from the TEXT, not the declared
 * version, so editing a document without bumping its version is still
 * detectable after the fact.
 */
export function agreementHash(doc: AgreementDocument): string {
  return createHash('sha256').update(agreementCanonicalText(doc), 'utf8').digest('hex');
}

export type SignatureRecord = {
  document: AgreementKey;
  signerKind: SignerKind;
  typedName: string;
  signedAt: number;
  documentVersion: string;
  /** True when the text has changed since this was signed. */
  stale: boolean;
};

export type AgreementState = {
  applicationId: string;
  signatures: SignatureRecord[];
  /** Outstanding (document, signer) pairs. Empty means fully signed. */
  outstanding: { document: AgreementKey; signerKind: SignerKind }[];
  fullySigned: boolean;
  guardianContact: { email: string; phone: string; altPhone: string | null } | null;
};

export function agreementStateFor(applicationId: string): AgreementState {
  const rows = db
    .select()
    .from(agreementSignature)
    .where(eq(agreementSignature.applicationId, applicationId))
    .all();

  const signatures: SignatureRecord[] = rows.map((r) => {
    const doc = agreementByKey(r.document);
    return {
      document: r.document,
      signerKind: r.signerKind,
      typedName: r.typedName,
      signedAt: r.signedAt,
      documentVersion: r.documentVersion,
      stale: doc ? agreementHash(doc) !== r.documentHash : true,
    };
  });

  const outstanding: { document: AgreementKey; signerKind: SignerKind }[] = [];
  for (const doc of AGREEMENTS) {
    for (const signer of doc.signers) {
      const has = rows.some((r) => r.document === doc.key && r.signerKind === signer);
      if (!has) outstanding.push({ document: doc.key, signerKind: signer });
    }
  }

  const contact = db
    .select()
    .from(guardianContact)
    .where(eq(guardianContact.applicationId, applicationId))
    .get();

  return {
    applicationId,
    signatures,
    outstanding,
    fullySigned: outstanding.length === 0,
    guardianContact: contact
      ? { email: contact.email, phone: contact.phone, altPhone: contact.altPhone }
      : null,
  };
}

export function isFullySigned(applicationId: string): boolean {
  return agreementStateFor(applicationId).fullySigned;
}

export type SignInput = {
  applicationId: string;
  document: AgreementKey;
  signerKind: SignerKind;
  signerUserId: string;
  typedName: string;
  ip: string | null;
  userAgent: string | null;
  /** Required with the participation agreement's guardian signature. */
  contact?: { email: string; phone: string; altPhone: string | null } | undefined;
};

/**
 * Record one signature.
 *
 * Idempotent: a double-clicked Sign, or a second tab, lands on the unique
 * index and changes nothing rather than writing a second row or erroring. The
 * FIRST signature is the one that counts — a later re-submission must not
 * quietly move the timestamp that evidences consent.
 */
export function signAgreement(input: SignInput): { created: boolean; state: AgreementState } {
  const doc = agreementByKey(input.document);
  if (!doc) {
    throw new AgreementError('unknown_document', 'No such agreement.', 404);
  }
  if (!doc.signers.includes(input.signerKind)) {
    throw new AgreementError(
      'wrong_signer',
      `The ${doc.title} is not signed by the ${input.signerKind}.`,
    );
  }

  const typed = input.typedName.trim();
  if (typed.length < 2) {
    throw new AgreementError('name_required', 'Type your full name to sign.', 400);
  }
  if (typed.length > 200) {
    throw new AgreementError('name_too_long', 'That name is too long.', 400);
  }

  // The contact block is part of the participation agreement, and it is the
  // only place the program ever collects a guardian phone number. Refuse to
  // record the guardian's signature without it.
  if (doc.collectsGuardianContact && input.signerKind === 'guardian') {
    const c = input.contact;
    if (!c || c.email.trim() === '' || c.phone.trim() === '') {
      throw new AgreementError(
        'contact_required',
        'An email address and a phone number are required.',
        400,
      );
    }
  }

  const stamp = now();
  const created = db.transaction((tx) => {
    const res = tx
      .insert(agreementSignature)
      .values({
        id: nanoid(),
        applicationId: input.applicationId,
        document: input.document,
        signerKind: input.signerKind,
        signerUserId: input.signerUserId,
        typedName: typed,
        documentVersion: doc.version,
        documentHash: agreementHash(doc),
        signedAt: stamp,
        ip: input.ip,
        userAgent: input.userAgent,
      })
      .onConflictDoNothing()
      .run();

    if (input.contact && doc.collectsGuardianContact && input.signerKind === 'guardian') {
      tx.insert(guardianContact)
        .values({
          applicationId: input.applicationId,
          email: input.contact.email.trim(),
          phone: input.contact.phone.trim(),
          altPhone: input.contact.altPhone?.trim() || null,
          updatedAt: stamp,
        })
        .onConflictDoUpdate({
          target: guardianContact.applicationId,
          set: {
            email: input.contact.email.trim(),
            phone: input.contact.phone.trim(),
            altPhone: input.contact.altPhone?.trim() || null,
            updatedAt: stamp,
          },
        })
        .run();
    }

    return res.changes > 0;
  });

  return { created, state: agreementStateFor(input.applicationId) };
}

/**
 * The gate. A student may take part when they are enrolled AND every required
 * signature is in. Both halves matter: paying does not waive the agreement,
 * and signing does not confer a seat.
 */
export function isCleared(applicationId: string): boolean {
  return isEnrolled(applicationId) && isFullySigned(applicationId);
}

export type OutstandingFamily = {
  applicationId: string;
  studentEmail: string;
  guardianEmail: string | null;
  guardianAccepted: boolean;
  outstanding: { document: AgreementKey; signerKind: SignerKind }[];
};

/**
 * Every enrolled family with a signature still missing — the admin chase list,
 * and the source for the reminder batch.
 *
 * `guardianAccepted` is false when the guardian has never consumed their
 * portal invite. Those families cannot be unblocked by a reminder about
 * signing; they need the invite itself, which is a different email.
 */
export function outstandingFamilies(): OutstandingFamily[] {
  const rows = db
    .select({
      applicationId: application.id,
      applicantUserId: application.applicantUserId,
      studentEmail: user.email,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .where(eq(application.status, 'enrolled'))
    .all();
  if (rows.length === 0) return [];

  const guardians = db
    .select({
      applicantUserId: guardianLink.applicantUserId,
      email: user.email,
      acceptedAt: guardianLink.acceptedAt,
    })
    .from(guardianLink)
    .innerJoin(user, eq(user.id, guardianLink.guardianUserId))
    .where(inArray(guardianLink.applicantUserId, rows.map((r) => r.applicantUserId)))
    .all();
  const guardianBy = new Map(guardians.map((g) => [g.applicantUserId, g]));

  const signed = db
    .select({
      applicationId: agreementSignature.applicationId,
      document: agreementSignature.document,
      signerKind: agreementSignature.signerKind,
    })
    .from(agreementSignature)
    .where(inArray(agreementSignature.applicationId, rows.map((r) => r.applicationId)))
    .all();

  const out: OutstandingFamily[] = [];
  for (const r of rows) {
    const mine = signed.filter((s) => s.applicationId === r.applicationId);
    const outstanding: { document: AgreementKey; signerKind: SignerKind }[] = [];
    for (const doc of AGREEMENTS) {
      for (const signer of doc.signers) {
        if (!mine.some((s) => s.document === doc.key && s.signerKind === signer)) {
          outstanding.push({ document: doc.key, signerKind: signer });
        }
      }
    }
    if (outstanding.length === 0) continue;

    const g = guardianBy.get(r.applicantUserId);
    out.push({
      applicationId: r.applicationId,
      studentEmail: r.studentEmail,
      guardianEmail: g?.email ?? null,
      guardianAccepted: g?.acceptedAt != null,
      outstanding,
    });
  }
  return out;
}

/** Resolve the application a signed-in student owns, if any. */
export function applicationIdForApplicant(userId: string): string | null {
  const row = db
    .select({ id: application.id })
    .from(application)
    .where(eq(application.applicantUserId, userId))
    .get();
  return row?.id ?? null;
}

/** True when this guardian is linked to this application. */
export function guardianOwns(guardianUserId: string, applicationId: string): boolean {
  const row = db
    .select({ id: guardianLink.id })
    .from(guardianLink)
    .innerJoin(application, eq(application.applicantUserId, guardianLink.applicantUserId))
    .where(
      and(eq(guardianLink.guardianUserId, guardianUserId), eq(application.id, applicationId)),
    )
    .get();
  return row !== undefined;
}
