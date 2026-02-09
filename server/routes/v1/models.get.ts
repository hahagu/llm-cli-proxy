import { getAdapter } from "~~/server/utils/adapters";
import { isConfiguredForUser, getAccessTokenForUser } from "~~/server/utils/claude-code-oauth";
import { getCachedModels, setCachedModels } from "~~/server/utils/model-cache";
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

  const configured = await isConfiguredForUser(keyData.userId);
  if (!configured) {
    return {
      object: "list",
      data: [],
      _warnings: ["Claude Code OAuth not configured"],
    };
  }

  const allModels: OpenAIModelEntry[] = [];
  const warnings: string[] = [];

  try {
    const cached = getCachedModels(keyData.userId, "claude-code");
    if (cached) {
      allModels.push(...cached);
    } else {
      const token = await getAccessTokenForUser(keyData.userId);
      const adapter = getAdapter();
      const models = await adapter.listModels(token);
      setCachedModels(keyData.userId, "claude-code", models);
      allModels.push(...models);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[models] claude-code failed: ${msg}`);
    warnings.push(msg);
  }

  return {
    object: "list",
    data: allModels,
    ...(warnings.length > 0 ? { _warnings: warnings } : {}),
  };
});
