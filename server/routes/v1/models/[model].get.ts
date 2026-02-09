import { getAdapter } from "~~/server/utils/adapters";
import { isConfiguredForUser, getAccessTokenForUser } from "~~/server/utils/claude-code-oauth";

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

  const configured = await isConfiguredForUser(keyData.userId);
  if (configured) {
    try {
      const token = await getAccessTokenForUser(keyData.userId);
      const adapter = getAdapter();
      const models = await adapter.listModels(token);
      const found = models.find((m) => m.id === modelId);
      if (found) {
        return found;
      }
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
