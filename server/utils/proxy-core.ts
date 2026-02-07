import { getConvexClient } from "./convex";
import { decrypt } from "./crypto";
import { getAdapter, detectProviderFromModel } from "./adapters";
import { getAccessTokenForUser, isConfiguredForUser } from "./claude-code-oauth";
import { api, internal } from "~~/convex/_generated/api";
import type { OpenAIChatRequest, OpenAIChatResponse } from "./adapters/types";

export interface ProxyKeyData {
  id: string;
  userId: string;
  isActive: boolean;
  rateLimitPerMinute: number | null;
}

async function getProviderCredentials(
  userId: string,
  providerType: string,
): Promise<{ apiKey: string } | null> {
  // claude-code uses per-user OAuth
  if (providerType === "claude-code") {
    const configured = await isConfiguredForUser(userId);
    if (!configured) return null;
    try {
      const token = await getAccessTokenForUser(userId);
      return { apiKey: token };
    } catch {
      return null;
    }
  }

  const convex = getConvexClient();
  const provider = await convex.query(api.providers.queries.getByUserAndType, {
    userId,
    type: providerType as "gemini" | "openrouter",
  });
  if (!provider) return null;
  try {
    const apiKey = decrypt(provider.encryptedApiKey, provider.keyIv);
    return { apiKey };
  } catch {
    return null;
  }
}

/**
 * System Prompt Hierarchy (highest to lowest priority):
 *
 * 1. API caller override - if request already has a system message, use it
 * 2. Global default - isDefault=true prompt from systemPrompts table
 * 3. No prompt - leave request as-is
 */
async function applySystemPromptHierarchy(
  request: OpenAIChatRequest,
  userId: string,
): Promise<OpenAIChatRequest> {
  // Tier 1: API caller override - if request already has system message, use as-is
  const hasCallerSystem = request.messages.some((m) => m.role === "system");
  if (hasCallerSystem) return request;

  // Tier 2: Global default prompt
  const convex = getConvexClient();
  try {
    const prompt = await convex.query(api.systemPrompts.queries.getForModel, {
      userId,
      model: request.model,
    });

    if (prompt) {
      return {
        ...request,
        messages: [
          { role: "system" as const, content: prompt.content },
          ...request.messages,
        ],
      };
    }
  } catch {
    // If the query fails, proceed without system prompt
  }

  return request;
}

async function logUsage(
  keyData: ProxyKeyData,
  providerType: string,
  model: string,
  statusCode: number,
  latencyMs: number,
  usage?: { prompt_tokens: number; completion_tokens: number },
  errorMessage?: string,
): Promise<void> {
  try {
    const convex = getConvexClient();
    await convex.mutation(internal.usageLogs.mutations.insert as any, {
      userId: keyData.userId,
      apiKeyId: keyData.id,
      providerType,
      model,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      latencyMs,
      statusCode,
      errorMessage,
    });
  } catch {
    // Fire-and-forget, don't fail the request
  }
}

export interface ProxyResult {
  type: "json" | "stream";
  data?: OpenAIChatResponse;
  stream?: ReadableStream<string>;
  providerType: string;
  model: string;
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Strip anything that looks like an API key or auth token
  return msg
    .replace(/sk-[a-zA-Z0-9]{10,}/g, "sk-***")
    .replace(/key-[a-zA-Z0-9]{10,}/g, "key-***")
    .replace(/AIza[a-zA-Z0-9_-]{30,}/g, "AIza***")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer ***")
    .replace(/x-api-key:\s*[^\s,]+/gi, "x-api-key: ***")
    .replace(/[?&]key=[^&\s]+/gi, "?key=***");
}

export async function executeProxyRequest(
  request: OpenAIChatRequest,
  keyData: ProxyKeyData,
): Promise<ProxyResult> {
  const startTime = Date.now();

  // Apply system prompt hierarchy for the requested model
  const requestWithPrompt = await applySystemPromptHierarchy(request, keyData.userId);

  // Detect provider from the model name
  const providerType = detectProviderFromModel(requestWithPrompt.model);
  if (!providerType) {
    logUsage(keyData, "none", request.model, 400, Date.now() - startTime, undefined, "Unknown model provider");
    throw new Error(`Cannot determine provider for model: ${request.model}`);
  }

  const creds = await getProviderCredentials(keyData.userId, providerType);
  if (!creds) {
    logUsage(keyData, providerType, request.model, 502, Date.now() - startTime, undefined, "No credentials configured");
    throw new Error(`No credentials configured for provider ${providerType}`);
  }

  try {
    const adapter = getAdapter(providerType);

    if (requestWithPrompt.stream) {
      const stream = await adapter.stream(requestWithPrompt, creds.apiKey);
      logUsage(keyData, providerType, requestWithPrompt.model, 200, Date.now() - startTime);
      return {
        type: "stream",
        stream,
        providerType: providerType,
        model: requestWithPrompt.model,
      };
    } else {
      const data = await adapter.complete(requestWithPrompt, creds.apiKey);
      logUsage(
        keyData,
        providerType,
        requestWithPrompt.model,
        200,
        Date.now() - startTime,
        data.usage
          ? {
              prompt_tokens: data.usage.prompt_tokens,
              completion_tokens: data.usage.completion_tokens,
            }
          : undefined,
      );
      return {
        type: "json",
        data,
        providerType: providerType,
        model: requestWithPrompt.model,
      };
    }
  } catch (err) {
    const safeError = sanitizeError(err);
    logUsage(keyData, providerType, request.model, 502, Date.now() - startTime, undefined, safeError);
    throw new Error(`Provider ${providerType} failed: ${safeError}`);
  }
}
