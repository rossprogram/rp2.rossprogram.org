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

export type ApplicationView = {
  id: string;
  status:
    | 'draft'
    | 'submitted'
    | 'under_review'
    | 'accepted'
    | 'waitlisted'
    | 'rejected'
    | 'withdrawn';
  submittedAt: number | null;
  updatedAt: number;
  responses: Record<string, unknown>;
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
  status: 'submitted';
  submittedAt: number;
}> {
  return api.post('/api/application/me/submit');
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
