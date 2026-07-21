import { useRef, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { Question } from '@rp2/shared';
import {
  listFiles,
  signUpload,
  registerFile,
  deleteFile,
  uploadFileWithProgress,
  fileDownloadUrl,
  type ApplicationFile,
} from '../../../api/client';

type Props = {
  question: Question & { type: 'file_upload' };
  disabled?: boolean | undefined;
};

const FILES_KEY = ['files'] as const;

export function FileUploadField({ question, disabled }: Props) {
  const qc = useQueryClient();
  const filesQuery = useQuery({
    queryKey: FILES_KEY,
    queryFn: async () => (await listFiles()).files,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filesForKind = (filesQuery.data ?? []).filter((f) => f.kind === question.kind);

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      setError(null);
      setProgress(0);
      const ticket = await signUpload({
        kind: question.kind,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });
      await uploadFileWithProgress(ticket.uploadUrl, file, (p) => setProgress(p));
      const result = await registerFile({
        kind: question.kind,
        storageKey: ticket.storageKey,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });
      return result.file;
    },
    onSuccess: () => {
      setProgress(null);
      qc.invalidateQueries({ queryKey: FILES_KEY });
    },
    onError: (err) => {
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Upload failed');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: FILES_KEY }),
  });

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!question.accept.includes(file.type)) {
      setError(
        `That file type isn't accepted. Please upload one of: ${question.accept.join(', ')}.`,
      );
      return;
    }
    uploadMut.mutate(file);
  }

  const allowMultiple = question.kind === 'aid_doc';
  const hasAny = filesForKind.length > 0;
  const isBusy = uploadMut.isPending || deleteMut.isPending;

  return (
    <div className="mb-8">
      <div className="block text-ink leading-snug">
        {question.prompt}
        {question.required && <RequiredMark />}
      </div>
      <div className="block text-muted text-sm italic mt-1">
        Accepted: {formatAccept(question.accept)}. Max 25&nbsp;MB per file.
      </div>

      <div className="mt-3 space-y-2">
        {filesForKind.map((f) => (
          <FileRow
            key={f.id}
            file={f}
            onDelete={() => deleteMut.mutate(f.id)}
            disabled={disabled || isBusy}
          />
        ))}
      </div>

      <div className="mt-3 flex items-center gap-4">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={question.accept.join(',')}
          onChange={onFileChange}
          disabled={disabled || isBusy}
        />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || isBusy}
        >
          {hasAny && !allowMultiple
            ? 'Replace file'
            : hasAny
              ? 'Upload another'
              : 'Choose a file'}
        </button>
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
      {error && <p className="mt-2 text-accent text-sm">{error}</p>}
    </div>
  );
}

function FileRow({
  file,
  onDelete,
  disabled,
}: {
  file: ApplicationFile;
  onDelete: () => void;
  disabled?: boolean | undefined;
}) {
  return (
    <div className="flex items-center gap-3 border border-rule bg-white px-3 py-2">
      <span className="flex-1 min-w-0">
        <a
          href={fileDownloadUrl(file.id)}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:underline block truncate"
        >
          {file.filename}
        </a>
        <span className="text-muted text-xs">
          {formatBytes(file.size)} · uploaded{' '}
          {new Date(file.uploadedAt * 1000).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          })}
        </span>
      </span>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        className="text-muted hover:text-accent text-sm"
      >
        Remove
      </button>
    </div>
  );
}

function formatAccept(types: readonly string[]): string {
  return types
    .map((t) =>
      t === 'application/pdf'
        ? 'PDF'
        : t === 'image/png'
          ? 'PNG'
          : t === 'image/jpeg'
            ? 'JPEG'
            : t,
    )
    .join(', ');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function RequiredMark() {
  return (
    <sup
      aria-hidden
      title="required"
      className="text-accent font-sans font-normal text-[0.7em] ml-1 tracking-normal cursor-help"
    >
      ∗
    </sup>
  );
}
