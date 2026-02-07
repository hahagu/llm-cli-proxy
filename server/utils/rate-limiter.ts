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

export function checkRateLimit(
  apiKeyId: string,
  limitPerMinute: number | null,
): boolean {
  if (!limitPerMinute) return true;

  const now = Date.now();
  let entry = buckets.get(apiKeyId);

  if (!entry) {
    entry = { timestamps: [] };
    buckets.set(apiKeyId, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => now - t < 60_000);

  if (entry.timestamps.length >= limitPerMinute) {
    return false;
  }

  entry.timestamps.push(now);
  return true;
}
