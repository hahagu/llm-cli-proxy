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

  if (body.type === "vertex-ai" && !body.projectId) {
    setResponseStatus(event, 400);
    return { error: "projectId is required for Vertex AI" };
  }

  // For Vertex AI, bundle apiKey + projectId + region into JSON before encrypting
  const credential = body.type === "vertex-ai"
    ? JSON.stringify({ apiKey: body.apiKey, projectId: body.projectId, region: body.region })
    : body.apiKey;

  const { encrypted, iv } = encrypt(credential);

  return {
    encryptedApiKey: encrypted,
    keyIv: iv,
    type: body.type,
  };
});
