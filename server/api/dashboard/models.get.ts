import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { getAdapter } from "~~/server/utils/adapters";
import { getAccessTokenForUser, isConfiguredForUser } from "~~/server/utils/claude-code-oauth";
import { api } from "~~/convex/_generated/api";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const query = getQuery(event);
  const providerTypeFilter = query.providerType as string | undefined;

  const convex = getConvexClient();
  const providers = await convex.query(api.providers.queries.listByUserId, {
    userId: session.userId,
  });

  const models: Array<{ id: string; provider: string; owned_by: string }> = [];

  for (const provider of providers) {
    if (providerTypeFilter && provider.type !== providerTypeFilter) continue;

    try {
      const apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
      const adapter = getAdapter(provider.type);
      const providerModels = await adapter.listModels(apiKey);
      for (const m of providerModels) {
        models.push({ id: m.id, provider: provider.type, owned_by: m.owned_by });
      }
    } catch {
      // Skip providers that fail
    }
  }

  // Also include claude-code models if configured for this user
  if (!providerTypeFilter || providerTypeFilter === "claude-code") {
    const configured = await isConfiguredForUser(session.userId);
    if (configured) {
      try {
        const token = await getAccessTokenForUser(session.userId);
        const adapter = getAdapter("claude-code");
        const ccModels = await adapter.listModels(token);
        for (const m of ccModels) {
          models.push({ id: m.id, provider: "claude-code", owned_by: m.owned_by });
        }
      } catch {
        // Skip if claude-code fails
      }
    }
  }

  return { models };
});
