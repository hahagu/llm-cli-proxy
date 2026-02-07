import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { getAdapter, parseModelWithProvider, getProviderDisplayPrefix } from "~~/server/utils/adapters";
import { isConfiguredForUser, getAccessTokenForUser } from "~~/server/utils/claude-code-oauth";
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

  const parsed = parseModelWithProvider(modelId);
  if (!parsed) {
    setResponseStatus(event, 404);
    return {
      error: {
        message: `Model '${modelId}' not found`,
        type: "invalid_request_error",
        code: "model_not_found",
      },
    };
  }
  const { provider: providerType, model: rawModel } = parsed;

  // Claude Code uses per-user OAuth, not the providers table
  if (providerType === "claude-code") {
    const configured = await isConfiguredForUser(keyData.userId);
    if (configured) {
      try {
        const token = await getAccessTokenForUser(keyData.userId);
        const adapter = getAdapter("claude-code");
        const models = await adapter.listModels(token);
        const found = models.find((m) => m.id === rawModel);
        if (found) {
          const dp = getProviderDisplayPrefix("claude-code");
          return {
            ...found,
            id: `claude-code:${found.id}`,
            name: found.name ? `${dp} - ${found.name}` : `${dp} - ${found.id}`,
          };
        }
      } catch {
        // Fall through to 404
      }
    }
  } else {
    const convex = getConvexClient();
    const provider = await convex.query(
      api.providers.queries.getByUserAndType,
      {
        userId: keyData.userId,
        type: providerType as "gemini" | "openrouter",
      },
    );

    if (provider) {
      try {
        const apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
        const adapter = getAdapter(providerType);
        const models = await adapter.listModels(apiKey);
        const found = models.find((m) => m.id === rawModel);
        if (found) {
          const dp = getProviderDisplayPrefix(providerType);
          return {
            ...found,
            id: `${providerType}:${found.id}`,
            name: found.name ? `${dp} - ${found.name}` : `${dp} - ${found.id}`,
          };
        }
      } catch {
        // Fall through to 404
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
