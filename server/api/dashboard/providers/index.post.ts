import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { encrypt } from "~~/server/utils/crypto";
import { createProviderSchema } from "~~/server/utils/validation";

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

  const parsed = createProviderSchema.safeParse(rawBody);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return {
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }

  const body = parsed.data;

  // Encrypt the provider API key
  const { encrypted, iv } = encrypt(body.apiKey);

  return {
    encryptedApiKey: encrypted,
    keyIv: iv,
    type: body.type,
  };
});
