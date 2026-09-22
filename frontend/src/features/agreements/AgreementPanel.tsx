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
  pending: boolean;
  error: string | null;
  onSign: (payload: SignPayload) => void;
};

function SignForm({
  doc,
  viewer,
  initialContact,
  defaultEmail,
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
  const canSign = typed.trim().length >= 2 && (!needsContact || phone.trim().length > 0);

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
        <input
          type="text"
          className="field-input mt-3 font-serif italic text-lg"
          value={typed}
          placeholder="Type your full name"
          disabled={pending}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>

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
  const [open, setOpen] = useState<string | null>(env.mine[0]?.document ?? null);
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
