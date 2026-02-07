import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { isConfiguredForUser } from "~~/server/utils/claude-code-oauth";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { configured: false };
  }

  const configured = await isConfiguredForUser(session.userId);
  return { configured };
});
