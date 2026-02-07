import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { clearTokensForUser } from "~~/server/utils/claude-code-oauth";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  await clearTokensForUser(session.userId);
  return { success: true };
});
