import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { getAdapter, getProviderDisplayPrefix } from "~~/server/utils/adapters";
import { isConfiguredForUser, getAccessTokenForUser } from "~~/server/utils/claude-code-oauth";
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
  const [providers, claudeCodeConfigured] = await Promise.all([
    convex.query(api.providers.queries.listByUserId, {
      userId: keyData.userId,
    }),
    isConfiguredForUser(keyData.userId),
  ]);

  const allModels: OpenAIModelEntry[] = [];
  const warnings: string[] = [];

  const providerTypes = providers.map((p) => p.type);
  if (claudeCodeConfigured) {
    providerTypes.unshift("claude-code");
  }

  // Build fetch tasks: Claude Code OAuth + providers table entries
  const fetchTasks: Array<Promise<{ type: string; models: OpenAIModelEntry[] }>> = [];

  if (claudeCodeConfigured) {
    fetchTasks.push(
      (async () => {
        const token = await getAccessTokenForUser(keyData.userId);
        const adapter = getAdapter("claude-code");
        return { type: "claude-code", models: await adapter.listModels(token) };
      })(),
    );
  }

  for (const provider of providers) {
    fetchTasks.push(
      (async () => {
        const apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
        const adapter = getAdapter(provider.type);
        return { type: provider.type, models: await adapter.listModels(apiKey) };
      })(),
    );
  }

  const results = await Promise.allSettled(fetchTasks);

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const type = claudeCodeConfigured
      ? (i === 0 ? "claude-code" : providers[i - 1]!.type)
      : providers[i]!.type;
    if (result.status === "fulfilled") {
      // Prefix model IDs and display names with provider type for disambiguation
      const displayPrefix = getProviderDisplayPrefix(type);
      const prefixed = result.value.models.map((m) => ({
        ...m,
        id: `${type}:${m.id}`,
        name: m.name ? `${displayPrefix} - ${m.name}` : `${displayPrefix} - ${m.id}`,
      }));
      allModels.push(...prefixed);
    } else {
      const msg = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      console.warn(`[models] ${type} failed: ${msg}`);
      warnings.push(`[${type}] ${msg}`);
    }
  }

  return {
    object: "list",
    data: allModels,
    _providers: providerTypes,
    ...(warnings.length > 0 ? { _warnings: warnings } : {}),
  };
});
