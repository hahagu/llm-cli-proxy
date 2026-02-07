import { randomBytes, createHash } from "node:crypto";
import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { getConvexClient } from "~~/server/utils/convex";
import { internal } from "~~/convex/_generated/api";
import { generateKeySchema } from "~~/server/utils/validation";

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

  const parsed = generateKeySchema.safeParse(rawBody);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return {
      error: parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }

  const body = parsed.data;

  // Generate a random API key
  const rawKey = "sk-" + randomBytes(32).toString("hex");
  const hashedKey = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 11); // "sk-xxxxxxxx"

  const convex = getConvexClient();

  try {
    await convex.mutation(internal.apiKeys.mutations.create as any, {
      userId: session.userId,
      hashedKey,
      keyPrefix,
      name: body.name,
      rateLimitPerMinute: body.rateLimitPerMinute,
    });
  } catch {
    setResponseStatus(event, 500);
    return { error: "Failed to store API key. Please try again." };
  }

  return {
    key: rawKey,
    prefix: keyPrefix,
    name: body.name,
  };
});
