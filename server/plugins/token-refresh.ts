import { refreshAllTokens } from "../utils/claude-code-oauth";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export default defineNitroPlugin((nitro) => {
  const interval = setInterval(async () => {
    try {
      await refreshAllTokens();
    } catch (err) {
      console.error(
        "[token-refresh] Periodic refresh error:",
        err instanceof Error ? err.message : err,
      );
    }
  }, REFRESH_INTERVAL_MS);

  nitro.hooks.hook("close", () => {
    clearInterval(interval);
  });
});
