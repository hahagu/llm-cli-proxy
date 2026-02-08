/**
 * Shared session token + fetch wrapper for dashboard API calls.
 *
 * With Better Auth's crossDomainClient, session cookies live on the Convex
 * domain. Nuxt server API routes can't see them, so we pass the session
 * token via Authorization header instead.
 */

let _sessionToken: string | null = null;

export function setSessionToken(token: string | null) {
  _sessionToken = token;
}

export function getSessionToken(): string | null {
  return _sessionToken;
}

/**
 * Wrapper around $fetch that automatically attaches the Better Auth
 * session token as a Bearer Authorization header.
 */
export function dashboardFetch<T = unknown>(
  url: string,
  opts?: Parameters<typeof $fetch>[1],
): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {};

  // Preserve any existing headers
  if (opts?.headers) {
    if (opts.headers instanceof Headers) {
      opts.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(opts.headers)) {
      for (const [k, v] of opts.headers) {
        headers[k] = v;
      }
    } else {
      Object.assign(headers, opts.headers);
    }
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return $fetch<T>(url, { ...opts, headers }) as Promise<T>;
}
