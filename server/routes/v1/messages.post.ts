import { executeProxyRequest } from "~~/server/utils/proxy-core";
import {
  anthropicToOpenAI,
  openAIToAnthropic,
  createOpenAIToAnthropicStreamTransformer,
  type AnthropicInboundRequest,
} from "~~/server/utils/adapters/anthropic-inbound";
import { anthropicMessagesRequestSchema } from "~~/server/utils/validation";

export default defineEventHandler(async (event) => {
  const keyData = event.context.apiKeyData;
  if (!keyData) {
    setResponseStatus(event, 401);
    return {
      type: "error",
      error: {
        type: "authentication_error",
        message: "Unauthorized",
      },
    };
  }

  let rawBody: unknown;
  try {
    rawBody = await readBody(event);
  } catch {
    setResponseStatus(event, 400);
    return {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Invalid request body",
      },
    };
  }

  const parsed = anthropicMessagesRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
    };
  }

  const anthropicBody = parsed.data as AnthropicInboundRequest;

  // Translate Anthropic request → OpenAI format
  const openAIRequest = anthropicToOpenAI(anthropicBody);

  try {
    const result = await executeProxyRequest(openAIRequest, keyData);

    if (result.type === "stream" && result.stream) {
      // Transform OpenAI SSE → Anthropic SSE
      setHeader(event, "Content-Type", "text/event-stream");
      setHeader(event, "Cache-Control", "no-cache");
      setHeader(event, "Connection", "keep-alive");
      setHeader(event, "X-Accel-Buffering", "no");

      const transformer = createOpenAIToAnthropicStreamTransformer(
        result.model,
      );
      const anthropicStream = result.stream
        .pipeThrough(
          new TransformStream<string, string>({
            transform(chunk, controller) {
              // Pass through - the chunk is already an SSE line
              controller.enqueue(chunk);
            },
          }),
        )
        .pipeThrough(transformer);

      const encoder = new TextEncoder();
      const byteStream = anthropicStream.pipeThrough(
        new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            controller.enqueue(encoder.encode(chunk));
          },
        }),
      );
      return sendStream(event, byteStream);
    }

    // Non-streaming: translate OpenAI response → Anthropic format
    if (result.data) {
      return openAIToAnthropic(result.data);
    }

    setResponseStatus(event, 500);
    return {
      type: "error",
      error: {
        type: "api_error",
        message: "No response data",
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal server error";
    setResponseStatus(event, 502);
    return {
      type: "error",
      error: {
        type: "api_error",
        message,
      },
    };
  }
});
