import type {
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  OpenAIContentPart,
  OpenAIStreamChunk,
  OpenAIToolCall,
} from "./types";
import { generateId, nowUnix } from "./types";

// --- Anthropic Request Types (inbound) ---

interface AnthropicContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  thinking?: string;
  source?: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
}

interface AnthropicInboundMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

interface AnthropicInboundTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
}

export interface AnthropicInboundRequest {
  model: string;
  messages: AnthropicInboundMessage[];
  system?: string | Array<{ type: "text"; text: string }>;
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicInboundTool[];
  tool_choice?: unknown;
  metadata?: { user_id?: string };
  thinking?: { type: "enabled"; budget_tokens: number };
}

// --- Anthropic Response Types (outbound) ---

export interface AnthropicOutboundResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

// --- Inbound Translation: Anthropic → OpenAI ---

function translateAnthropicContentToOpenAI(
  content: string | AnthropicContentBlock[],
): string | OpenAIContentPart[] {
  if (typeof content === "string") return content;

  const parts: OpenAIContentPart[] = [];
  for (const block of content) {
    if (block.type === "text" && block.text) {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image" && block.source) {
      if (block.source.type === "base64" && block.source.data) {
        const mimeType = block.source.media_type ?? "image/jpeg";
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${block.source.data}`,
          },
        });
      } else if (block.source.type === "url" && block.source.url) {
        parts.push({
          type: "image_url",
          image_url: { url: block.source.url },
        });
      }
    }
  }
  return parts.length === 1 && parts[0]?.type === "text" ? parts[0].text : parts;
}

export function anthropicToOpenAI(req: AnthropicInboundRequest): OpenAIChatRequest {
  const messages: OpenAIMessage[] = [];

  // Handle system prompt
  if (req.system) {
    const systemText = typeof req.system === "string"
      ? req.system
      : req.system.map((s) => s.text).join("\n");
    messages.push({ role: "system", content: systemText });
  }

  // Translate messages
  for (const msg of req.messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({ role: "user", content: msg.content });
      } else {
        // Check for tool_result blocks (these become tool messages)
        const toolResults = msg.content.filter((b) => b.type === "tool_result");
        const otherBlocks = msg.content.filter((b) => b.type !== "tool_result");

        if (otherBlocks.length > 0) {
          const content = translateAnthropicContentToOpenAI(otherBlocks);
          messages.push({ role: "user", content });
        }

        for (const tr of toolResults) {
          const resultContent = typeof tr.content === "string"
            ? tr.content
            : JSON.stringify(tr.content);
          messages.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: resultContent,
          });
        }
      }
      continue;
    }

    if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        messages.push({ role: "assistant", content: msg.content });
      } else {
        let textContent = "";
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            textContent += block.text;
          } else if (block.type === "tool_use") {
            toolCalls.push({
              id: block.id!,
              type: "function",
              function: {
                name: block.name!,
                arguments: JSON.stringify(block.input),
              },
            });
          }
        }

        messages.push({
          role: "assistant",
          content: textContent || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }
    }
  }

  const openAIReq: OpenAIChatRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens,
    stream: req.stream,
  };

  if (req.temperature !== undefined) openAIReq.temperature = req.temperature;
  if (req.top_p !== undefined) openAIReq.top_p = req.top_p;
  if (req.stop_sequences) {
    openAIReq.stop = req.stop_sequences;
  }

  if (req.tools && req.tools.length > 0) {
    openAIReq.tools = req.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  if (req.thinking) {
    openAIReq.thinking = req.thinking;
  }

  return openAIReq;
}

// --- Outbound Translation: OpenAI → Anthropic ---

function openAIFinishToAnthropicStop(
  reason: string | null | undefined,
): "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    default:
      return null;
  }
}

export function openAIToAnthropic(
  resp: OpenAIChatResponse,
): AnthropicOutboundResponse {
  const choice = resp.choices[0];
  const content: AnthropicContentBlock[] = [];

  if (choice?.message.reasoning_content) {
    content.push({ type: "thinking", thinking: choice.message.reasoning_content });
  }

  if (choice?.message.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  if (choice?.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments || "{}"),
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    id: resp.id.startsWith("msg_") ? resp.id : `msg_${resp.id}`,
    type: "message",
    role: "assistant",
    content,
    model: resp.model,
    stop_reason: openAIFinishToAnthropicStop(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
    },
  };
}

// --- Streaming: OpenAI chunks → Anthropic SSE events ---

export function createOpenAIToAnthropicStreamTransformer(
  model: string,
): TransformStream<string, string> {
  let messageStartSent = false;
  let contentBlockIndex = 0;
  let currentBlockOpen = false;
  let currentBlockType: "text" | "thinking" | "tool_use" | null = null;

  return new TransformStream({
    transform(sseData, controller) {
      // Incoming: "data: {...}\n\n" or "data: [DONE]\n\n"
      const line = sseData.trim();
      if (!line.startsWith("data: ")) return;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") {
        // Close any open content block
        if (currentBlockOpen) {
          controller.enqueue(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${contentBlockIndex}}\n\n`);
        }
        // Send message_delta with stop_reason and message_stop
        controller.enqueue(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n`);
        controller.enqueue(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
        return;
      }

      let chunk: OpenAIStreamChunk;
      try {
        chunk = JSON.parse(jsonStr);
      } catch {
        return;
      }

      const choice = chunk.choices?.[0];
      if (!choice) return;

      // Send message_start on first chunk
      if (!messageStartSent) {
        messageStartSent = true;
        const msgStart = {
          type: "message_start",
          message: {
            id: chunk.id.startsWith("msg_") ? chunk.id : `msg_${chunk.id}`,
            type: "message",
            role: "assistant",
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        };
        controller.enqueue(`event: message_start\ndata: ${JSON.stringify(msgStart)}\n\n`);
      }

      // Handle reasoning/thinking content
      if (choice.delta.reasoning_content !== undefined && choice.delta.reasoning_content !== null) {
        if (!currentBlockOpen || currentBlockType !== "thinking") {
          if (currentBlockOpen) {
            controller.enqueue(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${contentBlockIndex}}\n\n`);
            contentBlockIndex++;
          }
          controller.enqueue(`event: content_block_start\ndata: {"type":"content_block_start","index":${contentBlockIndex},"content_block":{"type":"thinking","thinking":""}}\n\n`);
          currentBlockOpen = true;
          currentBlockType = "thinking";
        }
        const delta = {
          type: "content_block_delta",
          index: contentBlockIndex,
          delta: { type: "thinking_delta", thinking: choice.delta.reasoning_content },
        };
        controller.enqueue(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
      }

      // Handle text content
      if (choice.delta.content !== undefined && choice.delta.content !== null) {
        if (!currentBlockOpen || currentBlockType !== "text") {
          if (currentBlockOpen) {
            controller.enqueue(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${contentBlockIndex}}\n\n`);
            contentBlockIndex++;
          }
          controller.enqueue(`event: content_block_start\ndata: {"type":"content_block_start","index":${contentBlockIndex},"content_block":{"type":"text","text":""}}\n\n`);
          currentBlockOpen = true;
          currentBlockType = "text";
        }
        const delta = {
          type: "content_block_delta",
          index: contentBlockIndex,
          delta: { type: "text_delta", text: choice.delta.content },
        };
        controller.enqueue(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
      }

      // Handle tool calls
      if (choice.delta.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          if (tc.id) {
            // New tool call starting
            if (currentBlockOpen) {
              controller.enqueue(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${contentBlockIndex}}\n\n`);
              contentBlockIndex++;
            }
            const blockStart = {
              type: "content_block_start",
              index: contentBlockIndex,
              content_block: {
                type: "tool_use",
                id: tc.id,
                name: tc.function?.name ?? "",
                input: {},
              },
            };
            controller.enqueue(`event: content_block_start\ndata: ${JSON.stringify(blockStart)}\n\n`);
            currentBlockOpen = true;
            currentBlockType = "tool_use";
          }
          if (tc.function?.arguments) {
            const delta = {
              type: "content_block_delta",
              index: contentBlockIndex,
              delta: {
                type: "input_json_delta",
                partial_json: tc.function.arguments,
              },
            };
            controller.enqueue(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
          }
        }
      }

      // Handle finish reason
      if (choice.finish_reason) {
        if (currentBlockOpen) {
          controller.enqueue(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${contentBlockIndex}}\n\n`);
          currentBlockOpen = false;
        }
        const stopReason = openAIFinishToAnthropicStop(choice.finish_reason);
        const usage = chunk.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        controller.enqueue(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":{"output_tokens":${usage.completion_tokens}}}\n\n`);
        controller.enqueue(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
      }
    },
  });
}
