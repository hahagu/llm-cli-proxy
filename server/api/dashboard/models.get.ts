import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { getAdapter } from "~~/server/utils/adapters";
import { getAccessTokenForUser, isConfiguredForUser } from "~~/server/utils/claude-code-oauth";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  const models: Array<{ id: string; owned_by: string; name?: string }> = [];

  const configured = await isConfiguredForUser(session.userId);
  if (configured) {
    try {
      const token = await getAccessTokenForUser(session.userId);
      const adapter = getAdapter();
      const ccModels = await adapter.listModels(token);
      for (const m of ccModels) {
        models.push({
          id: m.id,
          owned_by: m.owned_by,
          name: m.name ?? m.id,
        });
      }
    } catch {
      // Skip if claude-code fails
    }
  }

  return { models };
});
