import { useState } from 'react';
import type {
  AgreementDoc,
  AgreementEnvelope,
  Outstanding,
  SignPayload,
} from '../../api/client';

/*
 * Signing the two program agreements.
 *
 * One panel serves both portals. The student and the guardian sign the same
 * documents from different places, and each of them needs to see the other's
 * state — a family stuck half-signed is the normal case for weeks, and the
 * usual cause is each side assuming the other has already done it.
 */

function signedFor(env: AgreementEnvelope, doc: string, signer: 'student' | 'guardian') {
  return env.signatures.find((s) => s.document === doc && s.signerKind === signer) ?? null;
}

function formatSignedAt(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

function otherPartyLabel(viewer: 'student' | 'guardian', studentName: string | null): string {
  return viewer === 'student' ? 'your parent or guardian' : (studentName ?? 'your student');
}

/*
 * Compare two names the way a person would — the browser-side twin of
 * `sameName()` in backend/src/services/names.ts, and it must stay in step with
 * it. Accents, case, punctuation and word order all vary between what someone
 * typed on the application and what they type on a signature page, and the
 * sorted words are joined with no separator so a solid spelling matches a
 * spaced one.
 */
function sameName(a: string | null, b: string | null): boolean {
  const key = (s: string | null): string | null => {
    if (!s) return null;
    const words = s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .sort();
    return words.length > 0 ? words.join('') : null;
  };
  const ka = key(a);
  const kb = key(b);
  return ka !== null && ka === kb;
}

/** The document itself, rendered from the shared definition. */
function DocumentBody({ doc }: { doc: AgreementDoc }) {
  return (
    <div className="text-sm leading-relaxed">
      {doc.sections.map((section, i) => (
        <section key={i} className="mb-5">
          {section.heading ? (
            <h4 className="font-serif text-base font-semibold mb-2">{section.heading}</h4>
          ) : null}
          {section.blocks.map((block, j) =>
            block.kind === 'p' ? (
              <p key={j} className="mb-3 text-ink/90">
                {block.text}
              </p>
            ) : (
              <ul key={j} className="mb-3 list-disc pl-6 space-y-1 text-ink/90">
                {block.items.map((item, k) => (
                  <li key={k}>{item}</li>
                ))}
              </ul>
            ),
          )}
        </section>
      ))}
    </div>
  );
}

type SignFormProps = {
  doc: AgreementDoc;
  viewer: 'student' | 'guardian';
  /** Prefilled from the portal account, editable — the agreement asks for a
   * contact for the term, which is not necessarily the login address. */
  initialContact: { email: string; phone: string; altPhone: string | null } | null;
  defaultEmail: string;
  /** Who this line belongs to, and who it does not. */
  ownName: string | null;
  otherName: string | null;
  pending: boolean;
  error: string | null;
  onSign: (payload: SignPayload) => void;
};

function SignForm({
  doc,
  viewer,
  initialContact,
  defaultEmail,
  ownName,
  otherName,
  pending,
  error,
  onSign,
}: SignFormProps) {
  const [typed, setTyped] = useState('');
  const [email, setEmail] = useState(initialContact?.email ?? defaultEmail);
  const [phone, setPhone] = useState(initialContact?.phone ?? '');
  const [altPhone, setAltPhone] = useState(initialContact?.altPhone ?? '');

  // The contact block belongs to the participation agreement, and only the
  // guardian fills it in.
  const needsContact = doc.collectsGuardianContact && viewer === 'guardian';

  /*
   * The wrong person at the keyboard.
   *
   * The participation agreement is written in the guardian's voice — "I, the
   * undersigned, as parent or guardian..." — so a parent reading it over the
   * student's shoulder, on the student's logged-in browser, types their own
   * name into the participant's acknowledgement. Nine families did that before
   * this check existed, and none of them could undo it: a signature is
   * idempotent, so signing again changed nothing.
   *
   * Caught here rather than only on submit so the answer arrives while they
   * are still looking at the box. The server enforces the same rule; this is
   * the explanation, not the guard. Both allow the case where one name is
   * genuinely both — the check is skipped when the two names agree.
   */
  const namesAreDistinct = !sameName(ownName, otherName);
  const typedIsOther = namesAreDistinct && sameName(typed, otherName);

  const canSign =
    typed.trim().length >= 2 && !typedIsOther && (!needsContact || phone.trim().length > 0);

  return (
    <form
      className="mt-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSign || pending) return;
        onSign({
          typedName: typed.trim(),
          ...(needsContact
            ? {
                contact: {
                  email: email.trim(),
                  phone: phone.trim(),
                  altPhone: altPhone.trim() || null,
                },
              }
            : {}),
        });
      }}
    >
      {needsContact ? (
        <fieldset className="mb-6">
          <legend className="text-ink mb-1">How we reach you during the term</legend>
          <p className="text-muted text-sm italic mb-3">
            The agreement asks you to stay reachable and to respond within 24
            hours. This is the only place we collect a phone number.
          </p>
          <label className="block mb-3">
            <span className="block text-sm text-muted">Email</span>
            <input
              type="email"
              className="field-input mt-1"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block mb-3">
            <span className="block text-sm text-muted">Phone</span>
            <input
              type="tel"
              className="field-input mt-1"
              value={phone}
              required
              placeholder="+1 555 555 0100"
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-sm text-muted">
              Additional phone <span className="italic">(optional)</span>
            </span>
            <input
              type="tel"
              className="field-input mt-1"
              value={altPhone}
              onChange={(e) => setAltPhone(e.target.value)}
            />
          </label>
        </fieldset>
      ) : null}

      <label className="block">
        <span className="block text-ink">{doc.signatureLabel[viewer]}</span>
        <span className="block text-muted text-sm italic mt-1">
          Typing your name below acts as an electronic signature. It records
          your name, the moment you signed, and which version of this document
          you agreed to.
        </span>
        {/* Whose line this is, said plainly. The label above names a role;
            this names a person, which is what stops the wrong one signing. */}
        {ownName ? (
          <span className="block text-muted text-sm mt-1">
            This line is for{' '}
            <b className="text-ink">{ownName}</b>
            {viewer === 'student' ? ' — the participant.' : ' — the parent or guardian.'}
          </span>
        ) : null}
        <input
          type="text"
          className="field-input mt-3 font-serif italic text-lg"
          value={typed}
          /* Deliberately NOT the expected name: a signature box that shows
             the answer invites copying it rather than signing. Whose line it
             is, is said above instead. */
          placeholder="Type your full name"
          disabled={pending}
          aria-invalid={typedIsOther}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>

      {typedIsOther ? (
        <p className="text-sm mt-3 text-accent">
          {viewer === 'student' ? (
            <>
              That is <b>{otherName}</b>’s name, and this line is the
              participant’s. Type your own name here. Your parent or guardian
              signs this document themselves, from their own portal — we emailed
              them a link, and the button below will send it again.
            </>
          ) : (
            <>
              That is <b>{otherName}</b>’s name, and this line is the parent or
              guardian’s. Type your own name here.
            </>
          )}
        </p>
      ) : null}

      {error ? <p className="text-sm mt-3 text-accent">{error}</p> : null}

      <button type="submit" className="btn btn-primary mt-4" disabled={!canSign || pending}>
        {pending ? 'Signing…' : 'Sign'}
      </button>
    </form>
  );
}

type Props = {
  env: AgreementEnvelope;
  defaultEmail: string;
  pendingDocument: string | null;
  errorFor: (document: string) => string | null;
  onSign: (document: string, payload: SignPayload) => void;
  /** Rendered under the documents once everything is signed. */
  footer?: React.ReactNode;
  /** Resend the guardian's portal invite — only the student's view has this. */
  onResendGuardian?: (() => void) | undefined;
  resendState?: 'idle' | 'pending' | 'sent';
};

export function AgreementPanel({
  env,
  defaultEmail,
  pendingDocument,
  errorFor,
  onSign,
  footer,
  onResendGuardian,
  resendState = 'idle',
}: Props) {
  /*
   * Which document is expanded.
   *
   * `null` means "follow the work": show whatever this viewer still owes,
   * recomputed on every render, so signing one document opens the next
   * instead of leaving the finished one open with the remaining one collapsed
   * below a screenful of text. A real guardian stopped there — she signed the
   * Code of Conduct, saw a signed confirmation, and never opened the second
   * document. Only an explicit click pins a choice, and finishing that
   * document releases the pin.
   */
  const [pinned, setPinned] = useState<string | null>(null);
  const nextOwed = env.mine[0]?.document ?? null;
  const stillOwed = (key: string) => env.mine.some((o) => o.document === key);
  const open = pinned && (stillOwed(pinned) || pinned === nextOwed) ? pinned : nextOwed;
  const setOpen = (key: string | null) => setPinned(key);
  const other = otherPartyLabel(env.viewer, env.studentName);

  return (
    <div>
      {/* What this viewer still owes, stated before any document. */}
      {env.mine.length > 0 ? (
        <p className="text-lg text-ink/90 mb-6">
          {env.mine.length === 1
            ? 'One document still needs your signature.'
            : `${env.mine.length} documents still need your signature.`}
        </p>
      ) : env.theirs.length > 0 ? (
        <div className="mb-6">
          <p className="text-lg text-ink/90">
            You are done — thank you. We are still waiting on {other}.
          </p>
          <ul className="mt-2 text-muted text-sm list-disc pl-6">
            {env.theirs.map((o: Outstanding, i: number) => (
              <li key={i}>
                {env.documents.find((d) => d.key === o.document)?.title ?? o.document}
              </li>
            ))}
          </ul>
          {onResendGuardian ? (
            <button
              type="button"
              className="btn btn-ghost mt-3"
              disabled={resendState !== 'idle'}
              onClick={onResendGuardian}
            >
              {resendState === 'sent'
                ? 'Email sent'
                : resendState === 'pending'
                  ? 'Sending…'
                  : 'Email them a reminder'}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-lg text-ink/90 mb-6">
          Both signatures are in. Thank you.
        </p>
      )}

      <div className="rule-t">
        {env.documents.map((doc) => {
          const mine = signedFor(env, doc.key, env.viewer);
          const theirs = signedFor(
            env,
            doc.key,
            env.viewer === 'student' ? 'guardian' : 'student',
          );
          const isOpen = open === doc.key;

          return (
            <div key={doc.key} className="border-b border-rule/60 py-5">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <h3 className="font-serif text-xl">{doc.title}</h3>
                  <p className="text-sm text-muted mt-1">
                    {mine
                      ? `You signed ${formatSignedAt(mine.signedAt)}.`
                      : 'You have not signed this yet.'}{' '}
                    {theirs
                      ? `${env.viewer === 'student' ? 'Your parent or guardian' : env.studentName ?? 'Your student'} signed ${formatSignedAt(theirs.signedAt)}.`
                      : `Waiting on ${other}.`}
                  </p>
                  {mine?.stale ? (
                    <p className="text-sm text-accent mt-1">
                      This document has been updated since you signed it.
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="btn btn-ghost shrink-0"
                  onClick={() => setOpen(isOpen ? null : doc.key)}
                >
                  {isOpen ? 'Hide' : mine ? 'Read again' : 'Read and sign'}
                </button>
              </div>

              {isOpen ? (
                <div className="mt-5">
                  <div className="max-h-96 overflow-y-auto rounded border border-rule/60 p-5">
                    <DocumentBody doc={doc} />
                  </div>
                  {mine ? (
                    <p className="text-muted text-sm italic mt-4">
                      Signed as “{mine.typedName}” on {formatSignedAt(mine.signedAt)}.
                    </p>
                  ) : (
                    <SignForm
                      doc={doc}
                      viewer={env.viewer}
                      initialContact={env.guardianContact}
                      defaultEmail={defaultEmail}
                      ownName={
                        env.viewer === 'student' ? env.studentLegalName : env.guardianName
                      }
                      otherName={
                        env.viewer === 'student' ? env.guardianName : env.studentLegalName
                      }
                      pending={pendingDocument === doc.key}
                      error={errorFor(doc.key)}
                      onSign={(payload) => onSign(doc.key, payload)}
                    />
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {footer}
    </div>
  );
}
