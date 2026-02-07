import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { getAdapter } from "~~/server/utils/adapters";
import { getAccessTokenForUser, isConfiguredForUser } from "~~/server/utils/claude-code-oauth";
import { api } from "~~/convex/_generated/api";

const VALID_TYPES = ["claude-code", "gemini", "vertex-ai", "openrouter"] as const;

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { success: false, error: "Unauthorized" };
  }

  const body = await readBody(event);
  const type = body?.type as string;

  if (!type || !VALID_TYPES.includes(type as (typeof VALID_TYPES)[number])) {
    setResponseStatus(event, 400);
    return { success: false, error: "Invalid provider type" };
  }

  try {
    let apiKey: string;

    if (type === "claude-code") {
      // Claude Code uses per-user OAuth
      const configured = await isConfiguredForUser(session.userId);
      if (!configured) {
        return { success: false, error: "Claude Code OAuth not configured for your account" };
      }
      apiKey = await getAccessTokenForUser(session.userId);
    } else {
      const convex = getConvexClient();
      const provider = await convex.query(
        api.providers.queries.getByUserAndType,
        {
          userId: session.userId,
          type: type as "gemini" | "vertex-ai" | "openrouter",
        },
      );

      if (!provider) {
        return { success: false, error: "Provider not configured" };
      }

      apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
    }

    const adapter = getAdapter(type);
    const models = await adapter.listModels(apiKey);

    return { success: true, modelCount: models.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Strip sensitive info
    const safeMessage = message
      .replace(/sk-[a-zA-Z0-9]{10,}/g, "sk-***")
      .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "AIza***")
      .replace(/Bearer\s+[^\s]+/gi, "Bearer ***");
    return { success: false, error: safeMessage };
  }
});
