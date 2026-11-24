/** Query parameter used to carry a post-login destination through the auth pages. */
export const REDIRECT_PARAM = 'redirect';

/**
 * Validates a post-login destination.
 *
 * Only same-site absolute paths are allowed. Anything protocol-relative
 * (`//evil.com`) or absolute (`https://evil.com`) is discarded so a crafted
 * invitation or login link cannot turn into an open redirect.
 */
export function safeRedirectPath(value: string | null | undefined): string | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  if (decoded.startsWith('//')) return null;
  if (decoded.includes('\\') || decoded.includes('://')) return null;
  if (/[\u0000-\u001F\u007F]/.test(decoded)) return null;
  return decoded;
}

/** Builds `/login?redirect=<current path>` for a deep link that needs auth. */
export function loginPathWithRedirect(target: string): string {
  return `/login?${REDIRECT_PARAM}=${encodeURIComponent(target)}`;
}

/** Reads and validates the redirect destination from a location's query string. */
export function redirectFromSearch(search: string): string | null {
  return safeRedirectPath(new URLSearchParams(search).get(REDIRECT_PARAM));
}
