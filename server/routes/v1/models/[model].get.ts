import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { getAdapter, detectProviderFromModel } from "~~/server/utils/adapters";
import { api } from "~~/convex/_generated/api";

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

  const modelId = getRouterParam(event, "model");
  if (!modelId) {
    setResponseStatus(event, 400);
    return {
      error: {
        message: "Model ID is required",
        type: "invalid_request_error",
        code: "missing_model",
      },
    };
  }

  const providerType = detectProviderFromModel(modelId);
  if (!providerType) {
    setResponseStatus(event, 404);
    return {
      error: {
        message: `Model '${modelId}' not found`,
        type: "invalid_request_error",
        code: "model_not_found",
      },
    };
  }

  const convex = getConvexClient();
  const provider = await convex.query(
    api.providers.queries.getByUserAndType,
    {
      userId: keyData.userId,
      type: providerType as "claude-code" | "gemini" | "openrouter",
    },
  );

  if (provider) {
    try {
      const apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
      const adapter = getAdapter(providerType);
      const models = await adapter.listModels(apiKey);
      const found = models.find((m) => m.id === modelId);
      if (found) return found;
    } catch {
      // Fall through to 404
    }
  }

  setResponseStatus(event, 404);
  return {
    error: {
      message: `Model '${modelId}' not found`,
      type: "invalid_request_error",
      code: "model_not_found",
    },
  };
});
