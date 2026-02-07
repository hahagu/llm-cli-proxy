import { createHash } from "node:crypto";
import { getConvexClient } from "./convex";
import { api } from "~~/convex/_generated/api";

interface CachedKeyData {
  id: string;
  userId: string;
  isActive: boolean;
  rateLimitPerMinute: number | null;
  resolvedAt: number;
}

const KEY_CACHE = new Map<string, CachedKeyData>();
const CACHE_TTL_MS = 30_000;

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export async function resolveApiKey(
  bearerToken: string,
): Promise<CachedKeyData | null> {
  const hashed = hashApiKey(bearerToken);

  const cached = KEY_CACHE.get(hashed);
  if (cached && Date.now() - cached.resolvedAt < CACHE_TTL_MS) {
    return cached;
  }

  const convex = getConvexClient();
  const row = await convex.query(api.apiKeys.queries.getByHash, {
    hashedKey: hashed,
  });
  if (!row) return null;

  const data: CachedKeyData = {
    id: row._id,
    userId: row.userId,
    isActive: row.isActive,
    rateLimitPerMinute: row.rateLimitPerMinute ?? null,
    resolvedAt: Date.now(),
  };

  KEY_CACHE.set(hashed, data);
  return data;
}

export function extractBearerToken(
  header: string | null | undefined,
): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] ?? null : null;
}
