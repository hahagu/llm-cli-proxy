import { executeProxyRequest } from "~~/server/utils/proxy-core";
import type { OpenAIChatRequest } from "~~/server/utils/adapters/types";
import { chatCompletionRequestSchema } from "~~/server/utils/validation";
import { OpenAIError } from "~~/server/utils/errors";

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

  console.log("[COMPLETIONS] reading body...");
  let rawBody: unknown;
  try {
    rawBody = await readBody(event);
    console.log(`[COMPLETIONS] body read OK, size=${JSON.stringify(rawBody).length}`);
  } catch (err) {
    console.error("[COMPLETIONS] readBody failed:", err);
    setResponseStatus(event, 400);
    return {
      error: {
        message: "Invalid request body",
        type: "invalid_request_error",
        code: "invalid_body",
      },
    };
  }

  console.log("[COMPLETIONS] validating...");
  const parsed = chatCompletionRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    console.log("[COMPLETIONS] validation failed:", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    setResponseStatus(event, 400);
    return {
      error: {
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        type: "invalid_request_error",
        code: "validation_error",
      },
    };
  }
  console.log("[COMPLETIONS] validation OK, calling executeProxyRequest...");

  const body = parsed.data as OpenAIChatRequest;

  try {
    const result = await executeProxyRequest(body, keyData);
    console.log(`[COMPLETIONS] executeProxyRequest returned, type=${result.type}`);

    if (result.type === "stream" && result.stream) {
      setHeader(event, "Content-Type", "text/event-stream");
      setHeader(event, "Cache-Control", "no-cache");
      setHeader(event, "Connection", "keep-alive");
      setHeader(event, "X-Accel-Buffering", "no");
      const encoder = new TextEncoder();
      const byteStream = result.stream!.pipeThrough(
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
    console.error("[DEBUG /v1/chat/completions] error:", err);
    if (err instanceof OpenAIError) {
      setResponseStatus(event, err.statusCode);
      return err.toResponse();
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    setResponseStatus(event, 502);
    return {
      error: {
        message,
        type: "server_error",
        code: "all_providers_failed",
        param: null,
      },
    };
  }
});
