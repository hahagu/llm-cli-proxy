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

  for (const provider of providers) {
    try {
      const apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
      const adapter = getAdapter(provider.type);
      const models = await adapter.listModels(apiKey);
      allModels.push(...models);
    } catch {
      // Skip providers that fail
    }
  }

  return { object: "list", data: allModels };
});
