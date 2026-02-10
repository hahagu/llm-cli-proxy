import { getConvexClient } from "./convex";
import { getAdapter } from "./adapters";
import { getAccessTokenForUser, isConfiguredForUser } from "./claude-code-oauth";
import { api, internal } from "~~/convex/_generated/api";
import type { OpenAIChatRequest, OpenAIChatResponse } from "./adapters/types";
import { OpenAIError, invalidRequest, providerError } from "./errors";

export interface ProxyKeyData {
  id: string;
  userId: string;
  isActive: boolean;
  rateLimitPerMinute: number | null;
}

async function getCredentials(userId: string): Promise<string> {
  const configured = await isConfiguredForUser(userId);
  if (!configured) {
    throw providerError("Claude Code OAuth not configured for this user.");
  }
  return getAccessTokenForUser(userId);
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

interface RequestMeta {
  endpoint?: string;
  streamed?: boolean;
  messageCount?: number;
  hasTools?: boolean;
  temperature?: number;
  maxTokens?: number;
  stopReason?: string;
}

function extractRequestMeta(request: OpenAIChatRequest): RequestMeta {
  return {
    streamed: request.stream ?? false,
    messageCount: request.messages.length,
    hasTools: (request.tools?.length ?? 0) > 0,
    temperature: request.temperature,
    maxTokens: request.max_tokens,
  };
}

async function logUsage(
  keyData: ProxyKeyData,
  model: string,
  statusCode: number,
  latencyMs: number,
  usage?: { prompt_tokens: number; completion_tokens: number },
  errorMessage?: string,
  meta?: RequestMeta,
): Promise<void> {
  try {
    const convex = getConvexClient();
    await convex.mutation(internal.usageLogs.mutations.insert as any, {
      userId: keyData.userId,
      apiKeyId: keyData.id,
      providerType: "claude-code",
      model,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      latencyMs,
      statusCode,
      errorMessage,
      ...meta,
    });
  } catch {
    // Fire-and-forget, don't fail the request
  }
}

export interface ProxyResult {
  type: "json" | "stream";
  data?: OpenAIChatResponse;
  stream?: ReadableStream<string>;
  model: string;
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/sk-[a-zA-Z0-9]{10,}/g, "sk-***")
    .replace(/key-[a-zA-Z0-9]{10,}/g, "key-***")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer ***")
    .replace(/x-api-key:\s*[^\s,]+/gi, "x-api-key: ***");
}

export async function executeProxyRequest(
  request: OpenAIChatRequest,
  keyData: ProxyKeyData,
  endpoint?: string,
): Promise<ProxyResult> {
  const startTime = Date.now();

  // Apply system prompt hierarchy for the requested model
  const requestWithPrompt = await applySystemPromptHierarchy(request, keyData.userId);

  const model = requestWithPrompt.model;
  const meta: RequestMeta = { ...extractRequestMeta(requestWithPrompt), endpoint };

  let token: string;
  try {
    token = await getCredentials(keyData.userId);
  } catch {
    logUsage(keyData, model, 502, Date.now() - startTime, undefined, "No credentials configured", meta);
    throw providerError("Claude Code OAuth not configured for this user.");
  }

  try {
    const adapter = getAdapter();

    if (requestWithPrompt.stream) {
      const stream = await adapter.stream(requestWithPrompt, token);
      logUsage(keyData, model, 200, Date.now() - startTime, undefined, undefined, meta);
      return { type: "stream", stream, model };
    } else {
      const data = await adapter.complete(requestWithPrompt, token);
      const stopReason = data.choices?.[0]?.finish_reason ?? undefined;
      logUsage(
        keyData,
        model,
        200,
        Date.now() - startTime,
        data.usage
          ? {
              prompt_tokens: data.usage.prompt_tokens,
              completion_tokens: data.usage.completion_tokens,
            }
          : undefined,
        undefined,
        { ...meta, stopReason },
      );
      return { type: "json", data, model };
    }
  } catch (err) {
    if (err instanceof OpenAIError) {
      logUsage(keyData, model, err.statusCode, Date.now() - startTime, undefined, err.message, meta);
      throw err;
    }
    const safeError = sanitizeError(err);
    logUsage(keyData, model, 502, Date.now() - startTime, undefined, safeError, meta);
    throw providerError(`Provider failed: ${safeError}`);
  }
}
