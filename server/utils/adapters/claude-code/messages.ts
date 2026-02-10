/**
 * OpenAI → Claude Code SDK message conversion.
 *
 * Converts OpenAI chat messages into the format expected by the Claude
 * Agent SDK: a single `systemPrompt` string plus a `prompt` string (or
 * multimodal AsyncIterable).
 *
 * Conversation history is folded into the system prompt so the SDK's
 * single-turn `prompt` parameter only carries the current user input.
 * Tool calls and results use XML tags (<tool_call>, <tool_result>) that
 * mirror the native structure, helping the model maintain tool-use context
 * across follow-up turns.
 */

import type { OpenAIChatRequest, OpenAIMessage } from "../types";
import { randomUUID } from "crypto";

export function extractTextContent(
  content: string | Array<{ type: string; text?: string }> | null | undefined,
): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
}

/** Check if any user message contains image content parts. */
export function hasImageContent(messages: OpenAIMessage[]): boolean {
  return messages.some(
    (msg) =>
      msg.role === "user" &&
      Array.isArray(msg.content) &&
      msg.content.some((part) => part.type === "image_url"),
  );
}

/** Convert OpenAI content parts to Anthropic content blocks (text + images). */
function convertToAnthropicBlocks(
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | null,
): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!content) return [{ type: "text", text: "" }];

  const blocks: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (part.type === "text" && part.text) {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image_url" && part.image_url) {
      const url = part.image_url.url;
      if (url.startsWith("data:")) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: match[1], data: match[2] },
          });
        }
      } else {
        blocks.push({
          type: "image",
          source: { type: "url", url },
        });
      }
    }
  }
  return blocks.length > 0 ? blocks : [{ type: "text", text: "" }];
}

/**
 * Build prompt data for multimodal messages (images present).
 * Conversation history is folded into the system prompt.
 * The last user message is returned as Anthropic content blocks.
 */
export function convertMessagesMultimodal(request: OpenAIChatRequest): {
  systemPrompt: string | undefined;
  lastUserBlocks: Array<Record<string, unknown>>;
} {
  let systemPrompt = "";
  const historyParts: string[] = [];

  // Find last user message index
  let lastUserIdx = -1;
  for (let i = request.messages.length - 1; i >= 0; i--) {
    if (request.messages[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  for (let i = 0; i < request.messages.length; i++) {
    const msg = request.messages[i]!;

    if (msg.role === "system") {
      const text = extractTextContent(msg.content);
      systemPrompt = systemPrompt ? `${systemPrompt}\n${text}` : text;
      continue;
    }

    // Skip the last user message — it becomes the multimodal prompt
    if (i === lastUserIdx) continue;

    const text = extractTextContent(msg.content);
    switch (msg.role) {
      case "user":
        historyParts.push(`User: ${text}`);
        break;
      case "assistant": {
        let content = text;
        if (msg.tool_calls?.length) {
          const calls = msg.tool_calls
            .map(
              (tc) =>
                `<tool_call name="${tc.function.name}" id="${tc.id}">\n${tc.function.arguments}\n</tool_call>`,
            )
            .join("\n");
          content = content ? `${content}\n${calls}` : calls;
        }
        historyParts.push(`Assistant: ${content}`);
        break;
      }
      case "tool":
        historyParts.push(
          `<tool_result id="${msg.tool_call_id}">\n${text}\n</tool_result>`,
        );
        break;
    }
  }

  // Fold history into the system prompt so it's not lost
  if (historyParts.length > 0) {
    const history =
      "<conversation_history>\n" + historyParts.join("\n\n") + "\n</conversation_history>";
    systemPrompt = systemPrompt
      ? `${systemPrompt}\n\n${history}`
      : history;
  }

  const lastMsg = request.messages[lastUserIdx];
  const lastUserBlocks = lastMsg
    ? convertToAnthropicBlocks(lastMsg.content)
    : [{ type: "text", text: "" }];

  return {
    systemPrompt: systemPrompt || undefined,
    lastUserBlocks,
  };
}

/** Create an AsyncIterable that yields a single SDKUserMessage with multimodal content. */
export function createMultimodalPrompt(
  contentBlocks: Array<Record<string, unknown>>,
): AsyncIterable<Record<string, unknown>> {
  const sessionId = randomUUID();
  return {
    [Symbol.asyncIterator]() {
      let done = false;
      return {
        async next() {
          if (done) return { value: undefined, done: true };
          done = true;
          return {
            value: {
              type: "user",
              message: { role: "user", content: contentBlocks },
              parent_tool_use_id: null,
              session_id: sessionId,
            },
            done: false,
          };
        },
      };
    },
  };
}

/**
 * Convert OpenAI messages into a systemPrompt + prompt pair.
 *
 * Single user message → fast path (no history folding).
 * Multi-turn → history folded into systemPrompt with XML tool tags.
 */
export function convertMessages(request: OpenAIChatRequest): {
  systemPrompt: string | undefined;
  prompt: string;
} {
  let systemPrompt = "";
  const msgs = request.messages;

  // --- Fast path: single user message (no history to fold) ---
  const nonSystem = msgs.filter((m) => m.role !== "system");
  if (nonSystem.length === 1 && nonSystem[0]?.role === "user") {
    for (const m of msgs) {
      if (m.role === "system") {
        const t = extractTextContent(m.content);
        systemPrompt = systemPrompt ? `${systemPrompt}\n${t}` : t;
      }
    }
    return {
      systemPrompt: systemPrompt || undefined,
      prompt: extractTextContent(nonSystem[0].content),
    };
  }

  // --- Multi-turn conversation ---
  const lastMsg = msgs[msgs.length - 1];
  const endsWithUserMsg = lastMsg?.role === "user";
  const promptMsgIdx = endsWithUserMsg ? msgs.length - 1 : -1;

  const historyParts: string[] = [];

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]!;
    const text = extractTextContent(msg.content);

    switch (msg.role) {
      case "system":
        systemPrompt = systemPrompt ? `${systemPrompt}\n${text}` : text;
        break;
      case "user":
        if (i !== promptMsgIdx) {
          historyParts.push(`User: ${text}`);
        }
        break;
      case "assistant": {
        let content = text;
        if (msg.tool_calls?.length) {
          const calls = msg.tool_calls
            .map(
              (tc) =>
                `<tool_call name="${tc.function.name}" id="${tc.id}">\n${tc.function.arguments}\n</tool_call>`,
            )
            .join("\n");
          content = content ? `${content}\n${calls}` : calls;
        }
        historyParts.push(`Assistant: ${content}`);
        break;
      }
      case "tool":
        historyParts.push(
          `<tool_result id="${msg.tool_call_id}">\n${text}\n</tool_result>`,
        );
        break;
    }
  }

  if (historyParts.length > 0) {
    const history =
      "<conversation_history>\n" +
      historyParts.join("\n\n") +
      "\n</conversation_history>";
    systemPrompt = systemPrompt
      ? `${systemPrompt}\n\n${history}`
      : history;
  }

  const prompt =
    promptMsgIdx >= 0
      ? extractTextContent(msgs[promptMsgIdx]!.content)
      : "Continue with your task based on the conversation and tool results above.";

  return {
    systemPrompt: systemPrompt || undefined,
    prompt,
  };
}
