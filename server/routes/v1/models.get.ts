import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { getAdapter } from "~~/server/utils/adapters";
import { api } from "~~/convex/_generated/api";
import type { OpenAIModelEntry } from "~~/server/utils/adapters/types";

export default defineEventHandler(async (event) => {
  const keyData = event.context.apiKeyData;
  if (!keyData) {
    setResponseStatus(event, 401);
    return {
      error: {
        message: "Unauthorized",
        type: "invalid_request_error",
        code: "unauthorized",
      },
    };
  }

  const convex = getConvexClient();
  const providers = await convex.query(api.providers.queries.listByUserId, {
    userId: keyData.userId,
  });

  const allModels: OpenAIModelEntry[] = [];
  const warnings: string[] = [];

  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
      const adapter = getAdapter(provider.type);
      return { type: provider.type, models: await adapter.listModels(apiKey) };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      allModels.push(...result.value.models);
    } else {
      const msg = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      console.warn(`[models] provider failed: ${msg}`);
      warnings.push(msg);
    }
  }

  return {
    object: "list",
    data: allModels,
    ...(warnings.length > 0 ? { _warnings: warnings } : {}),
  };
});
