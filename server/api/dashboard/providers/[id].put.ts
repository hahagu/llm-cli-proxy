import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { encrypt } from "~~/server/utils/crypto";
import { updateProviderSchema } from "~~/server/utils/validation";

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  let rawBody: unknown;
  try {
    rawBody = await readBody(event);
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid request body" };
  }

  const parsed = updateProviderSchema.safeParse(rawBody);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return {
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }

  const body = parsed.data;
  const result: Record<string, unknown> = {};

  // If a new API key is provided, encrypt it
  if (body.apiKey) {
    const { encrypted, iv } = encrypt(body.apiKey);
    result.encryptedApiKey = encrypted;
    result.keyIv = iv;
  }

  return result;
});
