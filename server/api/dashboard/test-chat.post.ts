import { validateDashboardSession } from "~~/server/utils/dashboard-auth";
import { getConvexClient } from "~~/server/utils/convex";
import { executeProxyRequest } from "~~/server/utils/proxy-core";
import { chatCompletionRequestSchema } from "~~/server/utils/validation";
import { internal } from "~~/convex/_generated/api";
import type { OpenAIChatRequest } from "~~/server/utils/adapters/types";
import { z } from "zod";

const testChatSchema = z.object({
  apiKeyId: z.string().min(1),
  model: z.string().min(1),
  messages: chatCompletionRequestSchema.shape.messages,
  stream: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  const session = await validateDashboardSession(event);
  if (!session) {
    setResponseStatus(event, 401);
    return { error: "Unauthorized" };
  }

  let rawBody: unknown;
  try {
    rawBody = await readBody(event);
  } catch {
    setResponseStatus(event, 400);
    return { error: "Invalid request body" };
  }

  const parsed = testChatSchema.safeParse(rawBody);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }

  const body = parsed.data;

  // Look up the API key by ID and verify ownership
  const convex = getConvexClient();
  let apiKey: { _id: string; userId: string; isActive: boolean; rateLimitPerMinute?: number } | null;
  try {
    apiKey = await convex.query(internal.apiKeys.queries.getById as any, {
      id: body.apiKeyId,
    }) as any;
  } catch (err) {
    console.error("Failed to look up API key:", err);
    setResponseStatus(event, 500);
    return { error: "Failed to look up API key: " + (err instanceof Error ? err.message : String(err)) };
  }

  if (!apiKey || apiKey.userId !== session.userId) {
    setResponseStatus(event, 404);
    return { error: "API key not found" };
  }

  if (!apiKey.isActive) {
    setResponseStatus(event, 403);
    return { error: "API key is inactive" };
  }

  const keyData = {
    id: apiKey._id,
    userId: apiKey.userId,
    isActive: apiKey.isActive,
    rateLimitPerMinute: apiKey.rateLimitPerMinute ?? null,
  };

  const openAIRequest: OpenAIChatRequest = {
    model: body.model,
    messages: body.messages as OpenAIChatRequest["messages"],
    stream: body.stream,
  };

  try {
    const result = await executeProxyRequest(openAIRequest, keyData);

    if (result.type === "stream" && result.stream) {
      setHeader(event, "Content-Type", "text/event-stream");
      setHeader(event, "Cache-Control", "no-cache");
      setHeader(event, "Connection", "keep-alive");
      setHeader(event, "X-Accel-Buffering", "no");
      const encoder = new TextEncoder();
      const byteStream = result.stream.pipeThrough(
        new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk));
          },
        }),
      );
      return sendStream(event, byteStream);
    }

    return result.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    setResponseStatus(event, 502);
    return { error: message };
  }
});
