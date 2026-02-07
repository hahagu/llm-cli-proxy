import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { getAdapter, detectProvidersFromModel } from "~~/server/utils/adapters";
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

  // Try candidate providers for the model
  const candidates = detectProvidersFromModel(modelId);
  const convex = getConvexClient();

  for (const providerType of candidates) {
    const provider = await convex.query(
      api.providers.queries.getByUserAndType,
      {
        userId: keyData.userId,
        type: providerType as "claude-code" | "gemini" | "vertex-ai" | "openrouter",
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
        // Try next candidate
      }
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
