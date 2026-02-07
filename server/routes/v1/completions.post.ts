import { executeProxyRequest } from "~~/server/utils/proxy-core";
import type { OpenAIChatRequest } from "~~/server/utils/adapters/types";
import { completionRequestSchema } from "~~/server/utils/validation";
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

  let rawBody: unknown;
  try {
    rawBody = await readBody(event);
  } catch {
    setResponseStatus(event, 400);
    return {
      error: {
        message: "Invalid request body",
        type: "invalid_request_error",
        code: "invalid_body",
      },
    };
  }

  const parsed = completionRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return {
      error: {
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        type: "invalid_request_error",
        code: "validation_error",
      },
    };
  }

  const body = parsed.data;

  // Convert legacy completion prompt to chat messages
  const promptText = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt;
  const chatRequest: OpenAIChatRequest = {
    model: body.model,
    messages: [{ role: "user", content: promptText }],
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens,
    stream: body.stream,
    stop: body.stop,
    frequency_penalty: body.frequency_penalty,
    presence_penalty: body.presence_penalty,
    n: body.n,
    user: body.user,
  };

  try {
    const result = await executeProxyRequest(chatRequest, keyData);

    if (result.type === "stream" && result.stream) {
      // Transform chat completion stream chunks to legacy completion format
      setHeader(event, "Content-Type", "text/event-stream");
      setHeader(event, "Cache-Control", "no-cache");
      setHeader(event, "Connection", "keep-alive");
      setHeader(event, "X-Accel-Buffering", "no");

      const encoder = new TextEncoder();
      const transformedStream = result.stream.pipeThrough(
        new TransformStream<string, Uint8Array>({
          transform(chunk, controller) {
            if (chunk.startsWith("data: [DONE]")) {
              controller.enqueue(encoder.encode(chunk));
              return;
            }
            if (!chunk.startsWith("data: ")) {
              controller.enqueue(encoder.encode(chunk));
              return;
            }
            try {
              const data = JSON.parse(chunk.slice(6));
              const delta = data.choices?.[0]?.delta;
              const legacyChunk = {
                id: data.id,
                object: "text_completion",
                created: data.created,
                model: data.model,
                choices: [{
                  index: 0,
                  text: delta?.content ?? "",
                  finish_reason: data.choices?.[0]?.finish_reason ?? null,
                }],
                ...(data.usage ? { usage: data.usage } : {}),
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(legacyChunk)}\n\n`));
            } catch {
              controller.enqueue(encoder.encode(chunk));
            }
          },
        }),
      );
      return sendStream(event, transformedStream);
    }

    // Convert chat completion response to legacy completion format
    const chatResp = result.data!;
    return {
      id: chatResp.id,
      object: "text_completion",
      created: chatResp.created,
      model: chatResp.model,
      choices: chatResp.choices.map((c) => ({
        index: c.index,
        text: c.message.content ?? "",
        finish_reason: c.finish_reason,
      })),
      usage: chatResp.usage,
    };
  } catch (err) {
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
