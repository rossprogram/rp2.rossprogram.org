/*
 * The Code of Conduct and the Program Participation Agreement.
 *
 * Both are signed by BOTH the student and their guardian — four signatures per
 * family — and together with enrollment they are what clears a student to take
 * part. `isCleared()` at the bottom is the single predicate everything else
 * asks; nothing should re-derive it.
 */

import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
  agreementSignatureVoid,
  application,
  guardianContact,
  guardianLink,
  user,
} from '../db/schema.js';
import { isEnrolled } from './offers.js';
import {
  guardianNameFor,
  guardianNamesForMany,
  sameName,
  studentNamesFor,
  studentNamesForMany,
} from './names.js';

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
 * Whose name is this?
 *
 * Returns the signer kind the typed name belongs to, or null when it matches
 * neither party — which is the ordinary case for a nickname, a maiden name, or
 * any of the dozen spellings a real family uses, and is deliberately allowed.
 * Only an unambiguous match on the OTHER party is a problem.
 */
function whoseName(
  applicationId: string,
  typed: string,
): 'student' | 'guardian' | 'both' | null {
  const student = studentNamesFor(applicationId);
  const isStudent = sameName(typed, student.legal) || sameName(typed, student.preferred);
  const isGuardian = sameName(typed, guardianNameFor(applicationId));

  if (isStudent && isGuardian) return 'both';
  if (isStudent) return 'student';
  if (isGuardian) return 'guardian';
  return null;
}

function assertRightPerson(
  applicationId: string,
  signerKind: SignerKind,
  typed: string,
): void {
  const whose = whoseName(applicationId, typed);
  if (whose === null || whose === 'both' || whose === signerKind) return;

  throw new AgreementError(
    'wrong_person',
    signerKind === 'student'
      ? 'That is your parent or guardian’s name. This line is the participant’s — type your own name here. Your parent or guardian signs from their own portal, using the link we emailed them.'
      : 'That is the participant’s name. This line is the parent or guardian’s — type your own name here.',
    409,
  );
}

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

  // The wrong person at the keyboard.
  //
  // Both documents are read aloud in a family's living room, from whichever
  // browser happens to be open. The participation agreement is the trap: its
  // body is written in the guardian's voice ("I, the undersigned, as parent or
  // guardian..."), so a parent sitting at the student's logged-in portal
  // naturally types their OWN name into the participant's acknowledgement.
  // Nine families did exactly that before this check existed, and because a
  // signature is idempotent none of them could undo it themselves.
  //
  // So: refuse a signature typed with the other party's name. The escape hatch
  // is that it must not ALSO be the signer's own name — a student and a parent
  // are occasionally recorded under the same name on the application, and that
  // family must still be able to sign.
  assertRightPerson(input.applicationId, input.signerKind, typed);

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

/*
 * ==================== voiding and review ====================
 */

export type VoidInput = {
  applicationId: string;
  document: AgreementKey;
  signerKind: SignerKind;
  /** The admin doing it. Recorded, not inferred. */
  voidedByUserId: string;
  reason: string;
};

export type VoidRecord = {
  applicationId: string;
  studentName: string | null;
  document: AgreementKey;
  signerKind: SignerKind;
  typedName: string;
  signedAt: number;
  voidedAt: number;
  voidedByEmail: string | null;
  reason: string;
};

/**
 * Take back one signature.
 *
 * A signature is idempotent by design — the first one is the one that counts,
 * and re-signing is a no-op — which is right for a double-clicked button and
 * wrong for a signature made by the wrong person. This is the only way out of
 * that, and it is admin-only and deliberately noisy: the live row is deleted,
 * but every field of it lands in `agreement_signature_void` alongside who
 * voided it and why. A consent record you can quietly erase is not one.
 *
 * Afterwards the slot is simply outstanding again: the family shows up on the
 * chase list, the portal offers the document, and `isCleared()` is false until
 * it is re-signed. That last part matters — the next Discord reconcile will
 * strip the student's role, so voiding is not a silent bookkeeping change.
 */
export function voidSignature(input: VoidInput): { state: AgreementState } {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new AgreementError(
      'reason_required',
      'Say why this signature is being voided — it goes in the record.',
      400,
    );
  }
  if (reason.length > 1000) {
    throw new AgreementError('reason_too_long', 'That reason is too long.', 400);
  }

  db.transaction((tx) => {
    const row = tx
      .select()
      .from(agreementSignature)
      .where(
        and(
          eq(agreementSignature.applicationId, input.applicationId),
          eq(agreementSignature.document, input.document),
          eq(agreementSignature.signerKind, input.signerKind),
        ),
      )
      .get();

    if (!row) {
      throw new AgreementError('not_signed', 'There is no signature in that slot.', 404);
    }

    // Tombstone first, then delete. If anything goes wrong between them the
    // transaction rolls back and the signature survives — the failure mode
    // that loses evidence must not be the reachable one.
    tx.insert(agreementSignatureVoid)
      .values({
        id: nanoid(),
        signatureId: row.id,
        applicationId: row.applicationId,
        document: row.document,
        signerKind: row.signerKind,
        signerUserId: row.signerUserId,
        typedName: row.typedName,
        documentVersion: row.documentVersion,
        documentHash: row.documentHash,
        signedAt: row.signedAt,
        ip: row.ip,
        userAgent: row.userAgent,
        voidedByUserId: input.voidedByUserId,
        reason,
        voidedAt: now(),
      })
      .run();

    tx.delete(agreementSignature).where(eq(agreementSignature.id, row.id)).run();
  });

  return { state: agreementStateFor(input.applicationId) };
}

/**
 * The void ledger, newest first.
 *
 * Shown on the admin screen next to the suspect list, because a void is the
 * one thing here that destroys a live record. Making it permanently visible is
 * the cheapest guard against it becoming routine.
 */
export function recentVoids(limit = 100): VoidRecord[] {
  const rows = db
    .select({
      applicationId: agreementSignatureVoid.applicationId,
      document: agreementSignatureVoid.document,
      signerKind: agreementSignatureVoid.signerKind,
      typedName: agreementSignatureVoid.typedName,
      signedAt: agreementSignatureVoid.signedAt,
      voidedAt: agreementSignatureVoid.voidedAt,
      voidedByEmail: user.email,
      reason: agreementSignatureVoid.reason,
    })
    .from(agreementSignatureVoid)
    .leftJoin(user, eq(user.id, agreementSignatureVoid.voidedByUserId))
    .orderBy(desc(agreementSignatureVoid.voidedAt))
    .limit(limit)
    .all();

  const names = studentNamesForMany([...new Set(rows.map((r) => r.applicationId))]);
  return rows.map((r) => ({ ...r, studentName: names.get(r.applicationId)?.legal ?? null }));
}

/**
 * Why a signature is on the review list.
 *
 * `other_partys_name` is the signing-time rule applied backwards. It depends
 * on the guardian name recorded on the application, which is sometimes an
 * English name the parent never signs with, or simply misspelled — so
 * `duplicate_of_other_slot` exists to catch the same mistake without it: one
 * name standing in both halves of a document that two different people are
 * supposed to sign. Between them they found thirteen signatures across ten
 * families; neither found all thirteen alone.
 */
export type SuspectReason = 'other_partys_name' | 'duplicate_of_other_slot';

export type SuspectSignature = {
  applicationId: string;
  studentName: string | null;
  studentEmail: string;
  guardianName: string | null;
  document: AgreementKey;
  signerKind: SignerKind;
  typedName: string;
  signedAt: number;
  /** Which portal account was actually used — the telling detail. */
  signedFromEmail: string | null;
  reason: SuspectReason;
};

/**
 * Signatures that look like the wrong person typed them.
 *
 * This exists because the signing guard went in after ten families had already
 * tripped over it, and a rule that only applies going forward leaves those ten
 * invisible — they are not "outstanding", so the chase list will never show
 * them. A signature made by the wrong person reads as done.
 *
 * Nothing here decides anything. It is a list for a person to look at, which
 * is why the ambiguous cases are included rather than resolved: when one name
 * stands in both slots and matches neither party on file, both signatures are
 * listed and the admin says which is wrong.
 *
 * Scoped to enrolled families, same as the chase list.
 */
export function suspectSignatures(): SuspectSignature[] {
  const apps = db
    .select({
      applicationId: application.id,
      studentEmail: user.email,
    })
    .from(application)
    .innerJoin(user, eq(user.id, application.applicantUserId))
    .where(eq(application.status, 'enrolled'))
    .all();
  if (apps.length === 0) return [];

  const ids = apps.map((a) => a.applicationId);
  const studentNames = studentNamesForMany(ids);
  const guardianNames = guardianNamesForMany(ids);

  const rows = db
    .select({
      applicationId: agreementSignature.applicationId,
      document: agreementSignature.document,
      signerKind: agreementSignature.signerKind,
      typedName: agreementSignature.typedName,
      signedAt: agreementSignature.signedAt,
      signedFromEmail: user.email,
    })
    .from(agreementSignature)
    .leftJoin(user, eq(user.id, agreementSignature.signerUserId))
    .where(inArray(agreementSignature.applicationId, ids))
    .all();

  const out: SuspectSignature[] = [];

  for (const a of apps) {
    const student = studentNames.get(a.applicationId) ?? { legal: null, preferred: null };
    const guardianName = guardianNames.get(a.applicationId) ?? null;
    const mine = rows.filter((r) => r.applicationId === a.applicationId);

    // A family recorded under one name has nothing to tell apart. Skip it
    // wholesale rather than flagging every signature they make.
    const oneNamedFamily =
      sameName(student.legal, guardianName) || sameName(student.preferred, guardianName);

    const isStudentName = (n: string) =>
      sameName(n, student.legal) || sameName(n, student.preferred);
    const isGuardianName = (n: string) => sameName(n, guardianName);

    const flagged = new Set<string>();
    const slot = (r: { document: string; signerKind: string }) =>
      `${r.document}:${r.signerKind}`;

    const flag = (r: (typeof mine)[number], reason: SuspectReason) => {
      if (flagged.has(slot(r))) return;
      flagged.add(slot(r));
      out.push({
        applicationId: a.applicationId,
        studentName: student.legal,
        studentEmail: a.studentEmail,
        guardianName,
        document: r.document,
        signerKind: r.signerKind,
        typedName: r.typedName,
        signedAt: r.signedAt,
        signedFromEmail: r.signedFromEmail,
        reason,
      });
    };

    // Rule 1 — the signing guard, applied backwards.
    if (!oneNamedFamily) {
      for (const r of mine) {
        const belongsTo = isStudentName(r.typedName)
          ? 'student'
          : isGuardianName(r.typedName)
            ? 'guardian'
            : null;
        if (belongsTo !== null && belongsTo !== r.signerKind) {
          flag(r, 'other_partys_name');
        }
      }
    }

    // Rule 2 — one name in both halves of a document two people sign. Needs
    // nothing from the application, which is the point: it still works when
    // the guardian name on file is wrong or is a name they never sign with.
    if (!oneNamedFamily) {
      for (const doc of AGREEMENTS) {
        const st = mine.find((r) => r.document === doc.key && r.signerKind === 'student');
        const gu = mine.find((r) => r.document === doc.key && r.signerKind === 'guardian');
        if (!st || !gu || !sameName(st.typedName, gu.typedName)) continue;

        // When the shared name is recognisably one party's, only the other
        // party's slot is wrong. When it is neither — a parent who signs
        // under a name the application never recorded — both go on the list
        // and a person decides.
        if (isStudentName(st.typedName)) flag(gu, 'duplicate_of_other_slot');
        else if (isGuardianName(st.typedName)) flag(st, 'duplicate_of_other_slot');
        else {
          flag(st, 'duplicate_of_other_slot');
          flag(gu, 'duplicate_of_other_slot');
        }
      }
    }
  }

  out.sort((x, y) => x.signedAt - y.signedAt);
  return out;
}
