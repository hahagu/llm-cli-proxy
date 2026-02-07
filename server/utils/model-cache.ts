import type { OpenAIModelEntry } from "./adapters/types";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  models: OpenAIModelEntry[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(userId: string, providerType: string): string {
  return `${userId}:${providerType}`;
}

export function getCachedModels(
  userId: string,
  providerType: string,
): OpenAIModelEntry[] | null {
  const entry = cache.get(cacheKey(userId, providerType));
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.models;
}

export function setCachedModels(
  userId: string,
  providerType: string,
  models: OpenAIModelEntry[],
): void {
  cache.set(cacheKey(userId, providerType), {
    models,
    expiresAt: Date.now() + TTL_MS,
  });
}

export function invalidateModelsCache(userId?: string): void {
  if (!userId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${userId}:`)) {
      cache.delete(key);
    }
  }
}
