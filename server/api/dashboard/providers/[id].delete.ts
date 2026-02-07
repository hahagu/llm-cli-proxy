import { validateDashboardSession } from "~~/server/utils/dashboard-auth";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  // The actual deletion is done by the frontend calling the Convex mutation directly.
  // This endpoint just validates the session.
  return { ok: true };
});
