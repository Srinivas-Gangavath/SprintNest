const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'XMLHttpRequest';

interface ApiErrorResponse {
  status: 'error';
  statusCode: number;
  message: string;
  errors?: Array<{ field: string; message: string }>;
}

export class ApiError extends Error {
  public statusCode: number;
  public errors?: Array<{ field: string; message: string }>;

  constructor(data: ApiErrorResponse) {
    super(data.message);
    this.statusCode = data.statusCode;
    this.errors = data.errors;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};

  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  // Add CSRF header for state-changing methods
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers[CSRF_HEADER] = CSRF_VALUE;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  const text = await res.text();
  if (!text) {
    if (!res.ok) {
      throw new ApiError({ status: 'error', statusCode: res.status, message: 'Request failed' });
    }
    return undefined as T;
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ApiError({
      status: 'error',
      statusCode: res.status || 500,
      message: res.ok ? 'Unexpected response' : 'Request failed',
    });
  }

  if (!res.ok) {
    const payload = data as Partial<ApiErrorResponse>;
    throw new ApiError({
      status: 'error',
      statusCode: payload.statusCode || res.status,
      message: payload.message || 'Request failed',
      errors: payload.errors,
    });
  }

  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};
