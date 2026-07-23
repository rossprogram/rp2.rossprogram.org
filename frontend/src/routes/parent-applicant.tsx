import { useState } from 'react';
import { createRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { rootRoute } from './root';
import { Prose } from '../components/Layout';
import {
  ApiError,
  completeGuardianPart,
  fetchGuardianApplicantView,
  fetchMe,
  guardianDeleteFile,
  guardianRegisterFile,
  guardianSignUpload,
  patchGuardianTasks,
  uploadFileWithProgress,
  type ApplicationFile,
} from '../api/client';

async function ensureGuardian() {
  const me = await fetchMe();
  if (!me) throw redirect({ to: '/auth/request' });
  if (!me.roles.includes('guardian')) {
    throw redirect({ to: '/' });
  }
  return { me };
}

const AID_OPTIONS: Array<{ value: 'none' | 'partial' | 'full'; label: string }> = [
  { value: 'none', label: 'No aid requested' },
  { value: 'partial', label: 'Partial aid requested' },
  { value: 'full', label: 'Full aid requested' },
];

function GuardianApplicantPage() {
  const { appId } = parentApplicantRoute.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['parent', 'applicant', appId],
    queryFn: () => fetchGuardianApplicantView(appId),
  });

  if (q.isLoading) {
    return (
      <Prose>
        <p className="smallcaps text-accent mb-6">Parent portal</p>
        <h1 className="mb-4">Loading…</h1>
      </Prose>
    );
  }

  if (q.error || !q.data) {
    return (
      <Prose>
        <p className="smallcaps text-accent mb-6">Parent portal</p>
        <h1 className="mb-4">We couldn&rsquo;t find that application.</h1>
        <p className="text-muted mb-8">
          The link may have expired, or the student may have changed their
          parent contact.
        </p>
        <Link to="/parent" className="btn btn-ghost no-underline">
          Back to parent portal
        </Link>
      </Prose>
    );
  }

  const { applicant, files } = q.data;
  const displayName = applicant.applicantName || applicant.applicantEmail;
  const locked = applicant.status !== 'draft' && applicant.status !== 'awaiting_guardian';

  return (
    <Prose>
      <p className="smallcaps text-accent mb-6">Parent portal</p>
      <h1 className="mb-2">{displayName}</h1>
      <p className="text-muted mb-10">
        You&rsquo;re signing on behalf of <em>{displayName}</em>. Complete the
        two tasks below.
      </p>

      <ProgramFacts />

      <SignatureBlock
        appId={appId}
        initial={applicant.guardianSignature}
        disabled={locked}
        onSaved={() => qc.invalidateQueries({ queryKey: ['parent', 'applicant', appId] })}
      />

      <AidBlock
        appId={appId}
        initialLevel={applicant.aidLevel}
        files={files}
        disabled={locked}
        onChanged={() => qc.invalidateQueries({ queryKey: ['parent', 'applicant', appId] })}
      />

      <hr />

      <CompleteBlock
        appId={appId}
        canComplete={applicant.taskComplete && !locked}
        alreadyDone={applicant.guardianSubmittedAt !== null}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['parent', 'me'] });
          qc.invalidateQueries({ queryKey: ['parent', 'applicant', appId] });
          navigate({ to: '/parent' });
        }}
      />
    </Prose>
  );
}

function ProgramFacts() {
  return (
    <div className="rule-t rule-b py-4 my-6 grid grid-cols-2 gap-4 text-sm">
      <div>
        <div className="smallcaps text-muted">Program</div>
        <div className="text-ink">ℝℙ² pilot term</div>
      </div>
      <div>
        <div className="smallcaps text-muted">Dates</div>
        <div className="text-ink">Sep 28 – Dec 11, 2026</div>
      </div>
      <div>
        <div className="smallcaps text-muted">Format</div>
        <div className="text-ink">Weekly live Zoom sessions</div>
      </div>
      <div>
        <div className="smallcaps text-muted">Tuition</div>
        <div className="text-ink">~$1,500 (need-based aid available)</div>
      </div>
    </div>
  );
}

function SignatureBlock({
  appId,
  initial,
  disabled,
  onSaved,
}: {
  appId: string;
  initial: string | null;
  disabled: boolean;
  onSaved: () => void;
}) {
  const [typed, setTyped] = useState(initial ?? '');
  const [savedAt, setSavedAt] = useState<string | null>(
    initial ? new Date().toISOString() : null,
  );
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: (value: string) =>
      patchGuardianTasks(appId, { guardianSignature: value }),
    onSuccess: () => {
      setSavedAt(new Date().toISOString());
      setError(null);
      onSaved();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Save failed'),
  });

  return (
    <section className="mb-10">
      <h2 className="mb-3">Sign consent</h2>
      <p className="text-muted mb-4">
        Typing your name below records your name and the moment you signed. As
        the applicant&rsquo;s parent or guardian, you consent to their
        participation in ℝℙ² and agree to the{' '}
        <Link to="/terms" className="text-accent">
          terms of use
        </Link>{' '}
        and{' '}
        <Link to="/privacy" className="text-accent">
          privacy policy
        </Link>
        .
      </p>
      <input
        type="text"
        className="field-input font-serif italic text-lg"
        value={typed}
        disabled={disabled || mut.isPending}
        placeholder="Type your full name"
        onChange={(e) => setTyped(e.target.value)}
        onBlur={() => {
          const trimmed = typed.trim();
          if (trimmed !== (initial ?? '') && trimmed.length > 0) {
            mut.mutate(trimmed);
          }
        }}
      />
      {savedAt && typed.trim().length > 0 && (
        <p className="text-muted text-sm italic mt-2">
          Signed {formatSignedAt(savedAt)}
        </p>
      )}
      {error && <p className="text-accent text-sm mt-2">{error}</p>}
    </section>
  );
}

function AidBlock({
  appId,
  initialLevel,
  files,
  disabled,
  onChanged,
}: {
  appId: string;
  initialLevel: string | null;
  files: ApplicationFile[];
  disabled: boolean;
  onChanged: () => void;
}) {
  const [level, setLevel] = useState<'none' | 'partial' | 'full' | null>(
    initialLevel === 'partial' || initialLevel === 'full' || initialLevel === 'none'
      ? (initialLevel as 'none' | 'partial' | 'full')
      : null,
  );
  const [error, setError] = useState<string | null>(null);

  const levelMut = useMutation({
    mutationFn: (v: 'none' | 'partial' | 'full') =>
      patchGuardianTasks(appId, { aidLevel: v }),
    onSuccess: onChanged,
  });

  const needsDocs = level === 'partial' || level === 'full';

  return (
    <section className="mb-10">
      <h2 className="mb-3">Financial aid</h2>
      <p className="text-muted mb-4">
        Confirm whether the family is requesting financial aid. If yes, please
        upload supporting documentation (most recent tax return, W-2, or an
        equivalent summary).
      </p>

      <div className="mb-6 space-y-2">
        {AID_OPTIONS.map((opt) => (
          <label key={opt.value} className="flex items-center gap-3">
            <input
              type="radio"
              name="aid_level"
              value={opt.value}
              checked={level === opt.value}
              disabled={disabled || levelMut.isPending}
              onChange={() => {
                setLevel(opt.value);
                levelMut.mutate(opt.value);
              }}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>

      {needsDocs && (
        <GuardianFileUpload
          appId={appId}
          files={files}
          disabled={disabled}
          onChanged={onChanged}
          onError={setError}
        />
      )}
      {error && <p className="text-accent text-sm mt-2">{error}</p>}
    </section>
  );
}

const ACCEPTED = ['application/pdf', 'image/png', 'image/jpeg'];

function GuardianFileUpload({
  appId,
  files,
  disabled,
  onChanged,
  onError,
}: {
  appId: string;
  files: ApplicationFile[];
  disabled: boolean;
  onChanged: () => void;
  onError: (e: string | null) => void;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const qc = useQueryClient();

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      onError(null);
      setProgress(0);
      const { ticket } = await guardianSignUpload(appId, {
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });
      await uploadFileWithProgress(ticket.uploadUrl, file, (p) => setProgress(p));
      await guardianRegisterFile(appId, {
        storageKey: ticket.storageKey,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });
    },
    onSuccess: () => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: ['parent', 'applicant', appId] });
      onChanged();
    },
    onError: (err) => {
      setProgress(null);
      onError(err instanceof Error ? err.message : 'Upload failed');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => guardianDeleteFile(appId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['parent', 'applicant', appId] });
      onChanged();
    },
  });

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      onError('That file type isn’t accepted. Please upload a PDF, PNG, or JPEG.');
      return;
    }
    uploadMut.mutate(file);
  }

  const isBusy = uploadMut.isPending || deleteMut.isPending;

  return (
    <div className="mt-4">
      <div className="space-y-2">
        {files.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-3 border border-rule bg-white px-3 py-2"
          >
            <span className="flex-1 min-w-0">
              <span className="text-ink block truncate">{f.filename}</span>
              <span className="text-muted text-xs">
                {formatBytes(f.size)} · uploaded{' '}
                {new Date(f.uploadedAt * 1000).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </span>
            <button
              type="button"
              onClick={() => deleteMut.mutate(f.id)}
              disabled={disabled || isBusy}
              className="text-muted hover:text-accent text-sm"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-4">
        <label className="btn btn-ghost">
          {files.length === 0 ? 'Choose a file' : 'Upload another'}
          <input
            type="file"
            className="hidden"
            accept={ACCEPTED.join(',')}
            onChange={onFileChange}
            disabled={disabled || isBusy}
          />
        </label>
        {progress !== null && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <div className="w-32 h-1 bg-rule/60">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <span className="tabular-nums font-mono">
              {Math.round(progress * 100)}%
            </span>
          </div>
        )}
      </div>
      <p className="text-muted text-xs italic mt-2">
        Accepted: PDF, PNG, JPEG. Max 25&nbsp;MB per file.
      </p>
    </div>
  );
}

function CompleteBlock({
  appId,
  canComplete,
  alreadyDone,
  onDone,
}: {
  appId: string;
  canComplete: boolean;
  alreadyDone: boolean;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: () => completeGuardianPart(appId),
    onSuccess: () => {
      setError(null);
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError('Please finish signing and (if requested) uploading before completing.');
      } else {
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    },
  });

  if (alreadyDone) {
    return (
      <p className="text-accent mt-4">
        You’ve completed your parent-portal tasks for this student. Thank you.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <button
        className="btn btn-primary"
        disabled={!canComplete || mut.isPending}
        onClick={() => mut.mutate()}
        title={
          canComplete
            ? undefined
            : 'Sign consent and (if requesting aid) upload supporting documentation before completing.'
        }
      >
        {mut.isPending ? 'Submitting…' : 'Complete my part'}
      </button>
      {error && <p className="text-accent text-sm mt-2">{error}</p>}
    </div>
  );
}

function formatSignedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'long',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const Params = z.object({ appId: z.string().min(1) });

export const parentApplicantRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/parent/applicant/$appId',
  parseParams: (raw) => Params.parse(raw),
  beforeLoad: ensureGuardian,
  component: GuardianApplicantPage,
});
