/**
 * ClaudeCodeAdapter — the main adapter class.
 *
 * Implements the ProviderAdapter interface (complete, stream, listModels).
 * Delegates streaming to `createStream()` in streaming.ts and uses
 * helper modules for messages, MCP tools, thinking, and SDK options.
 */

import type {
  ProviderAdapter,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIModelEntry,
  OpenAIToolCall,
} from "../types";
import { generateId, nowUnix } from "../types";
import { mapProviderHttpError, providerError } from "../../errors";
import { randomUUID } from "crypto";

import {
  hasImageContent,
  convertMessages,
  convertMessagesMultimodal,
  createMultimodalPrompt,
} from "./messages";
import { stripMcpPrefix, buildMcpServer } from "./mcp-tools";
import { resolveThinkingMode, extractThinkingFromText } from "./thinking";
import { validateAndEnhanceRequest, buildSdkOptions } from "./sdk-options";
import { createStream } from "./streaming";

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly name = "claude-code";

  async complete(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<OpenAIChatResponse> {
    const { query } = await import("@anthropic-ai/claude-agent-sdk");
    const { promptSuffix, hasTools } = validateAndEnhanceRequest(request);

    const multimodal = hasImageContent(request.messages);
    const { systemPrompt, prompt } = multimodal
      ? (() => {
          const r = convertMessagesMultimodal(request);
          return {
            systemPrompt: r.systemPrompt,
            prompt: createMultimodalPrompt(r.lastUserBlocks),
          };
        })()
      : convertMessages(request);
    const requestId = generateId();

    // Build MCP server for client tools (if any)
    const mcpServer = hasTools ? await buildMcpServer(request.tools!) : undefined;

    let resultText = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const thinkingMode = resolveThinkingMode(request);
    const wantsThinking = thinkingMode !== "off";

    // Track native tool_use blocks from the model
    const nativeToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for await (const message of query({
      prompt: prompt as string,
      options: buildSdkOptions(request, systemPrompt, promptSuffix, providerApiKey, false, thinkingMode, mcpServer as Record<string, unknown> | undefined),
    })) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "text") {
            resultText += block.text;
          } else if (block.type === "tool_use") {
            const tb = block as { id?: string; name?: string; input?: unknown };
            const rawId = tb.id ?? "";
            const callId = rawId.startsWith("toolu_")
              ? `call_${rawId.slice(6)}`
              : rawId || `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
            nativeToolCalls.push({
              id: callId,
              name: stripMcpPrefix(tb.name ?? ""),
              arguments: typeof tb.input === "string" ? tb.input : JSON.stringify(tb.input ?? {}),
            });
          } else if (block.type === "image") {
            const source = (block as Record<string, unknown>).source as
              | { type: string; media_type?: string; data?: string }
              | undefined;
            if (source?.type === "base64" && source.data) {
              const mimeType = source.media_type ?? "image/png";
              resultText += `![image](data:${mimeType};base64,${source.data})`;
            }
          }
        }
      }

      if (message.type === "result") {
        if (message.subtype === "success" || message.subtype === "error_max_turns") {
          inputTokens = (message as any).usage?.input_tokens ?? 0;
          outputTokens = (message as any).usage?.output_tokens ?? 0;
        } else {
          const errors = (message as { errors?: string[] }).errors;
          throw providerError(
            `Claude Code error: ${errors?.join("; ") || message.subtype}`,
          );
        }
      }
    }

    // Extract thinking from text if thinking was requested
    const { thinking: thinkingText, content: cleanedText } = wantsThinking
      ? extractThinkingFromText(resultText)
      : { thinking: "", content: resultText };

    // Include tool_calls in the response if the model produced any.
    // Always use finish_reason "stop" — the client sees tool_calls in
    // the message and handles them without needing "tool_calls" reason.
    const toolCallsPayload: OpenAIToolCall[] | undefined =
      nativeToolCalls.length > 0
        ? nativeToolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          }))
        : undefined;

    return {
      id: requestId,
      object: "chat.completion",
      created: nowUnix(),
      model: request.model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: cleanedText || null,
            ...(thinkingText ? { reasoning_content: thinkingText } : {}),
            ...(toolCallsPayload ? { tool_calls: toolCallsPayload } : {}),
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    };
  }

  async stream(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<ReadableStream<string>> {
    return createStream(request, providerApiKey);
  }

  async listModels(providerApiKey: string): Promise<OpenAIModelEntry[]> {
    const resp = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "Authorization": `Bearer ${providerApiKey}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
        "anthropic-dangerous-direct-browser-access": "true",
        "User-Agent": "claude-cli/1.0.83",
        "X-App": "cli",
      },
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw mapProviderHttpError("Anthropic", resp.status, body);
    }

    const data = (await resp.json()) as {
      data?: Array<{ id: string; display_name?: string; created_at?: string }>;
    };

    if (!data.data || data.data.length === 0) {
      throw providerError(
        `Anthropic models API returned no models (response keys: ${Object.keys(data).join(", ")})`,
      );
    }

    return data.data.map((m) => ({
      id: m.id,
      object: "model" as const,
      created: m.created_at
        ? Math.floor(new Date(m.created_at).getTime() / 1000)
        : nowUnix(),
      owned_by: "anthropic-claude-code",
      ...(m.display_name ? { name: m.display_name } : {}),
    }));
  }
}
