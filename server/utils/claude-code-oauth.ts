import { getConvexClient } from "./convex";
import { encrypt, decrypt } from "./crypto";
import { api, internal } from "~~/convex/_generated/api";

const CLAUDE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL = "https://console.anthropic.com/v1/oauth/token";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// In-memory per-user cache with short TTL to avoid hitting Convex on every request
const tokenCache = new Map<
  string,
  { accessToken: string; expiresAt: number | null; cachedUntil: number }
>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute cache

// Per-user refresh deduplication
const refreshPromises = new Map<string, Promise<string>>();

/**
 * Store tokens for a user (after OAuth callback or token refresh).
 * Tokens are encrypted at rest in Convex.
 */
export async function storeTokensForUser(
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn?: number,
) {
  const encAccess = encrypt(accessToken);
  const encRefresh = encrypt(refreshToken);
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

  const convex = getConvexClient();
  await convex.mutation(internal.claudeCodeTokens.mutations.upsert as any, {
    userId,
    encryptedAccessToken: encAccess.encrypted,
    accessTokenIv: encAccess.iv,
    encryptedRefreshToken: encRefresh.encrypted,
    refreshTokenIv: encRefresh.iv,
    expiresAt,
  });

  // Update cache
  tokenCache.set(userId, {
    accessToken,
    expiresAt: expiresAt ?? null,
    cachedUntil: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Clear all stored tokens for a user (disconnect).
 */
export async function clearTokensForUser(userId: string) {
  const convex = getConvexClient();
  await convex.mutation(internal.claudeCodeTokens.mutations.remove as any, { userId });
  tokenCache.delete(userId);
  refreshPromises.delete(userId);
}

/**
 * Check if Claude Code OAuth is configured for a user.
 */
export async function isConfiguredForUser(userId: string): Promise<boolean> {
  const convex = getConvexClient();
  const tokens = await convex.query(api.claudeCodeTokens.queries.getByUserId, {
    userId,
  });
  return !!tokens;
}

/**
 * Load tokens from Convex and decrypt them.
 */
async function loadTokens(
  userId: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number | null;
} | null> {
  const convex = getConvexClient();
  const tokens = await convex.query(api.claudeCodeTokens.queries.getByUserId, {
    userId,
  });

  if (!tokens) return null;

  try {
    const accessToken = decrypt(
      tokens.encryptedAccessToken,
      tokens.accessTokenIv,
    );
    const refreshToken = decrypt(
      tokens.encryptedRefreshToken,
      tokens.refreshTokenIv,
    );
    return {
      accessToken,
      refreshToken,
      expiresAt: tokens.expiresAt ?? null,
    };
  } catch {
    return null;
  }
}

function isTokenExpired(expiresAt: number | null): boolean {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt - TOKEN_REFRESH_BUFFER_MS;
}

async function doRefresh(userId: string): Promise<string> {
  const tokens = await loadTokens(userId);
  if (!tokens) {
    throw new Error("Claude Code OAuth: no tokens found for user");
  }

  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: CLAUDE_CLIENT_ID,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `Claude Code OAuth refresh failed (${resp.status}): ${body}`,
    );
  }

  const data = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // Store the new tokens
  await storeTokensForUser(
    userId,
    data.access_token,
    data.refresh_token || tokens.refreshToken,
    data.expires_in,
  );

  return data.access_token;
}

/**
 * Returns the current valid OAuth access token for a user.
 * Refreshes automatically if expired. Deduplicates concurrent refresh calls.
 */
export async function getAccessTokenForUser(userId: string): Promise<string> {
  // Check in-memory cache first
  const cached = tokenCache.get(userId);
  if (cached && cached.cachedUntil > Date.now()) {
    if (!isTokenExpired(cached.expiresAt)) {
      return cached.accessToken;
    }
  }

  // Load from Convex
  const tokens = await loadTokens(userId);
  if (!tokens) {
    throw new Error("Claude Code OAuth not configured for this user.");
  }

  // Update cache
  tokenCache.set(userId, {
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt,
    cachedUntil: Date.now() + CACHE_TTL_MS,
  });

  if (!isTokenExpired(tokens.expiresAt)) {
    return tokens.accessToken;
  }

  // Deduplicate concurrent refresh requests per user
  let promise = refreshPromises.get(userId);
  if (!promise) {
    promise = doRefresh(userId).finally(() => {
      refreshPromises.delete(userId);
    });
    refreshPromises.set(userId, promise);
  }

  return promise;
}

/**
 * Get the Claude OAuth client ID (used by the auth start endpoint).
 */
export function getClientId(): string {
  return CLAUDE_CLIENT_ID;
}
