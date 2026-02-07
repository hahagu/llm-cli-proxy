interface RateLimitEntry {
  timestamps: number[];
}

const buckets = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 60_000);
    if (entry.timestamps.length === 0) {
      buckets.delete(key);
    }
  }
}, 5 * 60_000);

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  apiKeyId: string,
  limitPerMinute: number | null,
): RateLimitResult {
  if (!limitPerMinute) {
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 };
  }

  const now = Date.now();
  let entry = buckets.get(apiKeyId);

  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(apiKeyId, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < 60_000);

  const oldest = entry.timestamps[0];
  const resetAt = oldest ? Math.ceil((oldest + 60_000) / 1000) : Math.ceil((now + 60_000) / 1000);

  if (entry.timestamps.length >= limitPerMinute) {
    return {
      allowed: false,
      limit: limitPerMinute,
      remaining: 0,
      resetAt,
    };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    limit: limitPerMinute,
    remaining: limitPerMinute - entry.timestamps.length,
    resetAt,
  };
}
