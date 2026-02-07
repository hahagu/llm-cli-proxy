import type { H3Event } from "h3";

/**
 * Validates the Better Auth session from cookies by querying the Convex site's
 * auth session endpoint. Returns the user ID if valid, null otherwise.
 */
export async function validateDashboardSession(
  event: H3Event,
): Promise<{ userId: string } | null> {
  const siteUrl = process.env.VITE_CONVEX_SITE_URL;
  if (!siteUrl) return null;

  // Collect auth credentials to forward to the Better Auth session endpoint.
  // With crossDomainClient, session cookies live on the Convex domain,
  // so the client sends the session token via Authorization header instead.
  const headers: Record<string, string> = {};

  const cookieHeader = getHeader(event, "cookie");
  if (cookieHeader) headers.cookie = cookieHeader;

  const authHeader = getHeader(event, "authorization");
  if (authHeader) headers.authorization = authHeader;

  if (!headers.cookie && !headers.authorization) return null;

  try {
    const resp = await fetch(`${siteUrl}/api/auth/get-session`, { headers });

    if (!resp.ok) return null;

    const session = (await resp.json()) as {
      user?: { id?: string };
      session?: { userId?: string };
    };

    const userId = session?.user?.id || session?.session?.userId;
    if (!userId) return null;

    return { userId };
  } catch {
    return null;
  }
}
