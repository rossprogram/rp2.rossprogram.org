export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const init: RequestInit = { method, credentials: 'include' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = res.status === 204 ? null : isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

export type Me = {
  id: string;
  email: string;
  roles: string[];
};

export async function fetchMe(): Promise<Me | null> {
  try {
    return await api.get<Me>('/api/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export type ApplicationStatus =
  | 'draft'
  | 'awaiting_guardian'
  | 'submitted'
  | 'under_review'
  | 'accepted'
  | 'awaiting_payment'
  | 'enrolled'
  | 'declined'
  | 'waitlisted'
  | 'rejected'
  | 'withdrawn';

export type GuardianStatus = {
  hasLink: boolean;
  guardianEmail: string | null;
  invitedAt: number | null;
  acceptedAt: number | null;
  taskComplete: boolean;
};

export type ApplicationView = {
  id: string;
  status: ApplicationStatus;
  submittedAt: number | null;
  updatedAt: number;
  responses: Record<string, unknown>;
  guardian: GuardianStatus;
};

export function fetchApplication(): Promise<ApplicationView> {
  return api.get<ApplicationView>('/api/application/me');
}

export function patchResponses(
  responses: Record<string, unknown>,
): Promise<{ updatedAt: number }> {
  return api.patch('/api/application/me/responses', { responses });
}

export function submitApplication(): Promise<{
  id: string;
  status: 'submitted' | 'awaiting_guardian';
  submittedAt: number;
}> {
  return api.post('/api/application/me/submit');
}

export function resendGuardianInvite(): Promise<{ ok: true }> {
  return api.post('/api/application/me/resend-guardian-invite');
}

/* -------- guardian portal -------- */

export type GuardianApplicantSummary = {
  applicationId: string;
  applicantName: string;
  applicantEmail: string;
  status: ApplicationStatus;
  aidLevel: string | null;
  guardianSignature: string | null;
  aidDocCount: number;
  taskComplete: boolean;
  guardianSubmittedAt: number | null;
};

export function fetchMyLinkedApplicants(): Promise<{
  applicants: GuardianApplicantSummary[];
}> {
  return api.get('/api/parent/me');
}

export function fetchGuardianApplicantView(
  appId: string,
): Promise<{ applicant: GuardianApplicantSummary; files: ApplicationFile[] }> {
  return api.get(`/api/parent/applicant/${encodeURIComponent(appId)}`);
}

export function patchGuardianTasks(
  appId: string,
  input: { guardianSignature?: string; aidLevel?: 'none' | 'partial' | 'full' },
): Promise<{ ok: true }> {
  return api.patch(`/api/parent/applicant/${encodeURIComponent(appId)}`, input);
}

export function completeGuardianPart(
  appId: string,
): Promise<{ ok: true; status: ApplicationStatus }> {
  return api.post(`/api/parent/applicant/${encodeURIComponent(appId)}/complete`);
}

export function guardianSignUpload(
  appId: string,
  input: { filename: string; contentType: string; size: number },
): Promise<{
  ticket: { uploadUrl: string; storageKey: string; expiresAt: number };
}> {
  return api.post(
    `/api/parent/applicant/${encodeURIComponent(appId)}/uploads/sign`,
    input,
  );
}

export function guardianRegisterFile(
  appId: string,
  input: {
    storageKey: string;
    filename: string;
    contentType: string;
    size: number;
  },
): Promise<{ file: ApplicationFile }> {
  return api.post(
    `/api/parent/applicant/${encodeURIComponent(appId)}/files`,
    input,
  );
}

export function guardianDeleteFile(appId: string, fileId: string): Promise<void> {
  return api.delete(
    `/api/parent/applicant/${encodeURIComponent(appId)}/files/${encodeURIComponent(fileId)}`,
  );
}

export type SignInRole = 'applicant' | 'guardian';

export function requestSignInLink(input: {
  email: string;
  role: SignInRole;
}): Promise<void> {
  return api.post('/api/auth/request-link', input);
}

export function inviteApplicantFromParent(input: {
  applicantEmail: string;
  relationship: 'parent' | 'guardian' | 'other';
}): Promise<{ ok: true; alreadyLinked: boolean }> {
  return api.post('/api/parent/invite-applicant', input);
}

export type ApplicationFile = {
  id: string;
  kind: 'transcript' | 'aid_doc';
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: number;
};

export function listFiles(): Promise<{ files: ApplicationFile[] }> {
  return api.get('/api/application/me/files');
}

export function signUpload(input: {
  kind: 'transcript' | 'aid_doc';
  filename: string;
  contentType: string;
  size: number;
}): Promise<{ uploadUrl: string; storageKey: string; expiresAt: number }> {
  return api.post('/api/uploads/sign', input);
}

export function registerFile(input: {
  kind: 'transcript' | 'aid_doc';
  storageKey: string;
  filename: string;
  contentType: string;
  size: number;
}): Promise<{ file: ApplicationFile }> {
  return api.post('/api/application/me/files', input);
}

export function deleteFile(id: string): Promise<void> {
  return api.delete(`/api/application/me/files/${encodeURIComponent(id)}`);
}

export function fileDownloadUrl(id: string): string {
  return `/api/application/me/files/${encodeURIComponent(id)}/download`;
}

/* -------- admin -------- */

export type AdminListRow = {
  id: string;
  applicantUserId: string;
  applicantEmail: string;
  legalName: string | null;
  preferredName: string | null;
  location: string | null;
  gradeLevel: string | null;
  status: ApplicationStatus;
  submittedAt: number | null;
  updatedAt: number;
  guardianEmail: string | null;
  guardianAccepted: boolean;
  coursePreferences: string[];
  fileCount: number;
};

export function fetchAdminApplications(
  includeDrafts = false,
): Promise<{ applications: AdminListRow[] }> {
  const q = includeDrafts ? '?includeDrafts=true' : '';
  return api.get(`/api/admin/applications${q}`);
}

export type AdminApplicationDetail = {
  id: string;
  applicantUserId: string;
  applicantEmail: string;
  status: ApplicationStatus;
  submittedAt: number | null;
  guardianSubmittedAt: number | null;
  updatedAt: number;
  createdAt: number;
  responses: Record<string, unknown>;
  availability: { weekday: number; startMin: number; endMin: number }[];
  coursePreferences: { courseKey: string; rank: number }[];
  files: ApplicationFile[];
  guardian: {
    email: string;
    acceptedAt: number | null;
    invitedAt: number | null;
    relationship: 'parent' | 'guardian' | 'other';
  } | null;
};

export function fetchAdminApplication(
  id: string,
): Promise<{ application: AdminApplicationDetail }> {
  return api.get(`/api/admin/applications/${encodeURIComponent(id)}`);
}

export function adminFileDownloadUrl(appId: string, fileId: string): string {
  return `/api/admin/applications/${encodeURIComponent(appId)}/files/${encodeURIComponent(fileId)}/download`;
}

export function uploadFileWithProgress(
  uploadUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`upload failed: ${xhr.status}`));
    };
    xhr.onerror = () => reject(new Error('upload failed'));
    xhr.send(file);
  });
}

/* -------- offers -------- */

export type OfferView = {
  courseKey: string | null;
  courseLabel: string | null;
  section: string | null;
  cohort: string | null;
  problemSession: string | null;
  officeHours: string | null;
  tuitionCents: number;
  aidAmountCents: number;
  amountDueCents: number;
  enrollmentDeadline: string | null;
  notes: string | null;
  response: 'accepted' | 'declined' | null;
  respondedAt: number | null;
  respondedByKind: 'student' | 'guardian' | null;
  paidCents: number;
  pastDeadline: boolean;
  paymentsEnabled: boolean;
};

export type OfferEnvelope = {
  applicationId: string;
  status: ApplicationStatus;
  actorKind: 'student' | 'guardian';
  studentName: string | null;
  offer: OfferView | null;
};

export type OfferResponseResult = {
  status: ApplicationStatus;
  idempotent: boolean;
};

export function fetchOffer(appId: string): Promise<OfferEnvelope> {
  return api.get<OfferEnvelope>(`/api/offer/${encodeURIComponent(appId)}`);
}

export function respondToOffer(
  appId: string,
  response: 'accept' | 'decline',
): Promise<OfferResponseResult> {
  return api.post<OfferResponseResult>(
    `/api/offer/${encodeURIComponent(appId)}/${response}`,
  );
}

export function createCheckoutSession(appId: string): Promise<{ url: string }> {
  return api.post<{ url: string }>(
    `/api/offer/${encodeURIComponent(appId)}/checkout-session`,
  );
}

/* -------- admin: offer import -------- */

export type ImportIssue = {
  row: number;
  column: string | null;
  code: string;
  message: string;
};

export type ImportChange = {
  field: string;
  column: string;
  before: unknown;
  after: unknown;
};

export type ImportRow = {
  row: number;
  appId: string;
  studentName: string | null;
  studentEmail: string | null;
  currentStatus: ApplicationStatus | null;
  changes: ImportChange[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
};

export type ImportPreview = {
  fileHash: string;
  filename: string;
  rowCount: number;
  appliedColumns: string[];
  absentColumns: string[];
  unknownColumns: string[];
  changedRows: ImportRow[];
  errorRows: ImportRow[];
  warningRows: ImportRow[];
  unchangedCount: number;
  errorCount: number;
  fatal: ImportIssue[];
};

export type PublishResult = {
  importId: string;
  applied: number;
  changedAppIds: string[];
  alreadyPublished: boolean;
};

export type NotifyResult = {
  sent: number;
  skipped: number;
  recipients: string[];
};

export type ImportRecord = {
  id: string;
  filename: string;
  rowCount: number;
  changedCount: number;
  createdAt: number;
  notifiedAt: number | null;
  notifiedCount: number | null;
};

/**
 * POST a file as raw bytes. The backend already parses octet-stream into a
 * Buffer for the presigned-PUT flow, so this needs no multipart handling.
 */
async function postBinary<T>(
  path: string,
  file: File,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/octet-stream', ...headers },
    body: file,
  });
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export function offerTemplateUrl(format: 'csv' | 'xlsx'): string {
  return `/api/admin/offers/template?format=${format}`;
}

export async function previewOfferImport(file: File): Promise<ImportPreview> {
  const res = await postBinary<{ preview: ImportPreview }>(
    `/api/admin/offers/preview?filename=${encodeURIComponent(file.name)}`,
    file,
  );
  return res.preview;
}

export function publishOfferImport(
  file: File,
  importId: string,
  fileHash: string,
): Promise<PublishResult> {
  return postBinary<PublishResult>(
    `/api/admin/offers/publish?filename=${encodeURIComponent(file.name)}`,
    file,
    { 'x-import-id': importId, 'x-file-hash': fileHash },
  );
}

export function notifyImport(importId: string): Promise<NotifyResult> {
  return api.post<NotifyResult>(
    `/api/admin/offers/imports/${encodeURIComponent(importId)}/notify`,
  );
}

export async function fetchImports(): Promise<ImportRecord[]> {
  const res = await api.get<{ imports: ImportRecord[] }>('/api/admin/offers/imports');
  return res.imports;
}
