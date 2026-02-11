/**
 * SSE streaming for the Claude Code adapter.
 *
 * Creates a ReadableStream<string> that translates Claude Agent SDK
 * stream events into OpenAI-compatible SSE chunks. Handles:
 *
 * - Text delta streaming (including thinking tag detection)
 * - Two-phase tool_call emission (Phase 1: id/name, Phase 2: args)
 * - Standard OpenAI tool_call streaming (init chunk + arg fragments)
 * - Usage reporting and graceful client disconnection
 */

import type { OpenAIChatRequest, OpenAIStreamChunk } from "../types";
import { generateId, nowUnix } from "../types";
import { providerError } from "../../errors";
import { randomUUID } from "crypto";
import { stripMcpPrefix, buildMcpServer } from "./mcp-tools";
import { resolveThinkingMode } from "./thinking";
import {
  hasImageContent,
  convertMessages,
  convertMessagesMultimodal,
  createMultimodalPrompt,
} from "./messages";
import { validateAndEnhanceRequest, buildSdkOptions } from "./sdk-options";

/**
 * Create an SSE ReadableStream for a streaming chat completion request.
 *
 * This is the core of the streaming adapter — it wires up the SDK's
 * `query()` async iterator to an OpenAI-compatible SSE stream.
 */
export async function createStream(
  request: OpenAIChatRequest,
  providerApiKey: string,
): Promise<ReadableStream<string>> {
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const { promptSuffix, hasTools } = validateAndEnhanceRequest(request);

  // Build MCP server for client tools (if any)
  const mcpServer = hasTools ? await buildMcpServer(request.tools!) : undefined;

  if (process.env.DEBUG_SDK) {
    const toolNames = request.tools?.map((t) => t.function.name) ?? [];
    console.log("[SDK:req]", JSON.stringify({
      model: request.model,
      hasTools,
      toolNames,
      mcpServer: !!mcpServer,
      msgCount: request.messages.length,
      roles: request.messages.map((m) => m.role),
      promptSuffixLen: promptSuffix.length,
    }));
  }

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
  const model = request.model;
  const includeUsage = !!request.stream_options?.include_usage;

  const thinkingMode = resolveThinkingMode(request);
  const wantsThinking = thinkingMode !== "off";

  const sdkQuery = query({
    prompt: prompt as string,
    options: buildSdkOptions(request, systemPrompt, promptSuffix, providerApiKey, true, thinkingMode, mcpServer as Record<string, unknown> | undefined),
  });

  let streamClosed = false;

  return new ReadableStream<string>({
    async start(controller) {
      // Safe stream helpers — handle client disconnection gracefully.
      // Defined outside try/catch so safeError is accessible in catch.
      function safeEnqueue(data: string) {
        if (streamClosed) return;
        try { controller.enqueue(data); } catch { streamClosed = true; }
      }
      function safeClose() {
        if (streamClosed) return;
        streamClosed = true;
        try { controller.close(); } catch { /* already closed */ }
      }
      function safeError(err: unknown) {
        if (streamClosed) return;
        streamClosed = true;
        try { controller.error(err); } catch { /* already closed */ }
      }

      try {
        let sentRole = false;

        // --- Thinking tag detection state machine ---
        const OPEN_TAG = "<thinking>";
        const CLOSE_TAG = "</thinking>";
        type ThinkingState = "detect_start" | "in_thinking" | "in_content" | "passthrough";
        let thinkingState: ThinkingState = wantsThinking ? "detect_start" : "passthrough";
        let tagBuffer = "";

        // --- Native tool_use tracking ---
        const nativeToolCalls: Array<{ id: string; name: string }> = [];
        let currentToolUse: { id: string; name: string; index: number } | null = null;

        function emitThinkingDelta(text: string) {
          if (!text) return;
          const chunk: OpenAIStreamChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: nowUnix(),
            model,
            choices: [{ index: 0, delta: { reasoning_content: text }, logprobs: null, finish_reason: null }],
          };
          safeEnqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        function emitTextDelta(text: string) {
          if (!text) return;
          const chunk: OpenAIStreamChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: nowUnix(),
            model,
            choices: [{ index: 0, delta: { content: text }, logprobs: null, finish_reason: null }],
          };
          safeEnqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        }

        /** Process incoming text through thinking tag detection. */
        function feedText(incoming: string) {
          if (thinkingState === "passthrough") {
            emitTextDelta(incoming);
            return;
          }

          if (thinkingState === "detect_start") {
            tagBuffer += incoming;
            const trimmed = tagBuffer.trimStart();
            if (trimmed.length >= OPEN_TAG.length) {
              if (trimmed.startsWith(OPEN_TAG)) {
                thinkingState = "in_thinking";
                const afterTag = trimmed.slice(OPEN_TAG.length);
                tagBuffer = "";
                if (afterTag) feedText(afterTag);
              } else {
                thinkingState = "passthrough";
                const buf = tagBuffer;
                tagBuffer = "";
                emitTextDelta(buf);
              }
            } else if (trimmed.length > 0 && !OPEN_TAG.startsWith(trimmed)) {
              thinkingState = "passthrough";
              const buf = tagBuffer;
              tagBuffer = "";
              emitTextDelta(buf);
            }
            return;
          }

          if (thinkingState === "in_thinking") {
            tagBuffer += incoming;
            const closeIdx = tagBuffer.indexOf(CLOSE_TAG);
            if (closeIdx !== -1) {
              const thinkingContent = tagBuffer.slice(0, closeIdx);
              const afterTag = tagBuffer.slice(closeIdx + CLOSE_TAG.length);
              tagBuffer = "";
              thinkingState = "in_content";
              emitThinkingDelta(thinkingContent);
              if (afterTag) feedText(afterTag);
            } else {
              const safeLen = tagBuffer.length - (CLOSE_TAG.length - 1);
              if (safeLen > 0) {
                emitThinkingDelta(tagBuffer.slice(0, safeLen));
                tagBuffer = tagBuffer.slice(safeLen);
              }
            }
            return;
          }

          if (thinkingState === "in_content") {
            emitTextDelta(incoming);
            return;
          }
        }

        function flushPending() {
          if (tagBuffer) {
            if (thinkingState === "in_thinking" || thinkingState === "detect_start") {
              if (thinkingState === "in_thinking") {
                emitThinkingDelta(tagBuffer);
              } else {
                emitTextDelta(tagBuffer);
              }
            }
            tagBuffer = "";
          }
        }

        // Track usage across turns for the final chunk.
        let lastUsage: Record<string, number> | undefined;

        for await (const message of sdkQuery) {
          // Debug logging (skip noisy text deltas)
          if (process.env.DEBUG_SDK) {
            let logIt = false;
            const summary: Record<string, unknown> = { type: message.type };
            if ("subtype" in message) { summary.subtype = (message as any).subtype; logIt = true; }
            if (message.type === "stream_event") {
              const ev = (message as any).event;
              if (ev?.type !== "content_block_delta") {
                summary.eventType = ev?.type;
                if (ev?.type === "content_block_start") summary.blockType = ev?.content_block?.type;
                logIt = true;
              }
            }
            if (message.type === "assistant") {
              const blocks = (message as any).message?.content;
              summary.blocks = blocks?.map((b: any) => ({ type: b.type, ...(b.name ? { name: b.name } : {}) }));
              logIt = true;
            }
            if (message.type === "system" && (message as any).subtype === "init") {
              const tools = (message as any).tools;
              summary.availableTools = tools?.map((t: any) => t.name ?? t);
              summary.permissionMode = (message as any).permissionMode;
              logIt = true;
            }
            if (logIt) console.log("[SDK]", JSON.stringify(summary));
          }

          if (message.type === "stream_event") {
            const event = message.event as Record<string, unknown>;

            // --- message_start: emit role chunk ---
            if (event.type === "message_start") {
              if (!sentRole) {
                sentRole = true;
                const chunk: OpenAIStreamChunk = {
                  id: requestId,
                  object: "chat.completion.chunk",
                  created: nowUnix(),
                  model,
                  choices: [{
                    index: 0,
                    delta: { role: "assistant", content: "" },
                    logprobs: null,
                    finish_reason: null,
                  }],
                };
                safeEnqueue(`data: ${JSON.stringify(chunk)}\n\n`);
              }
            }

            // --- content_block_start: begin tool_use, emit init chunk immediately ---
            if (event.type === "content_block_start") {
              const block = event.content_block as Record<string, unknown> | undefined;
              if (block?.type === "tool_use") {
                const rawId = (block.id as string) ?? "";
                const callId = rawId.startsWith("toolu_")
                  ? `call_${rawId.slice(6)}`
                  : rawId || `call_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
                const toolName = stripMcpPrefix((block.name as string) ?? "");
                const toolIndex = nativeToolCalls.length;
                currentToolUse = { id: callId, name: toolName, index: toolIndex };

                // Standard OpenAI init chunk: id/type/name + arguments: ""
                const initChunk: OpenAIStreamChunk = {
                  id: requestId,
                  object: "chat.completion.chunk",
                  created: nowUnix(),
                  model,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: toolIndex,
                        id: callId,
                        type: "function",
                        function: { name: toolName, arguments: "" },
                      }],
                    },
                    logprobs: null,
                    finish_reason: null,
                  }],
                };
                safeEnqueue(`data: ${JSON.stringify(initChunk)}\n\n`);

                if (process.env.DEBUG_SDK) {
                  console.log("[SDK:tool_use:start]", JSON.stringify({ id: callId, name: toolName, rawId, rawName: block.name }));
                }
              }
            }

            // --- content_block_delta: stream tool arg fragments or text ---
            if (event.type === "content_block_delta") {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === "input_json_delta" && currentToolUse) {
                const fragment = (delta.partial_json as string) ?? "";
                const argChunk: OpenAIStreamChunk = {
                  id: requestId,
                  object: "chat.completion.chunk",
                  created: nowUnix(),
                  model,
                  choices: [{
                    index: 0,
                    delta: {
                      tool_calls: [{
                        index: currentToolUse.index,
                        function: { arguments: fragment },
                      }],
                    },
                    logprobs: null,
                    finish_reason: null,
                  }],
                };
                safeEnqueue(`data: ${JSON.stringify(argChunk)}\n\n`);
              } else if (delta?.type === "text_delta" && delta.text) {
                feedText(delta.text as string);
              }
            }

            // --- content_block_stop: finalize tool_use, signal completion ---
            if (event.type === "content_block_stop") {
              if (currentToolUse) {
                nativeToolCalls.push({
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                });
                if (process.env.DEBUG_SDK) {
                  console.log("[SDK:tool_use:complete]", JSON.stringify({ id: currentToolUse.id, name: currentToolUse.name }));
                }
                currentToolUse = null;
              }
            }

            // --- message_delta: flush pending + capture usage ---
            if (event.type === "message_delta") {
              flushPending();
              lastUsage = (event.usage as Record<string, number> | undefined) ?? lastUsage;
            }
          }

          if (message.type === "result") {
            if (message.subtype === "success" || message.subtype === "error_max_turns") {
              lastUsage = ((message as any).usage as Record<string, number> | undefined) ?? lastUsage;
            } else {
              const errors = (message as { errors?: string[] }).errors;
              throw providerError(
                `Claude Code error: ${errors?.join("; ") || message.subtype}`,
              );
            }
          }
        }

        // All done — flush buffers and emit final chunks.
        flushPending();
        const stopReason = nativeToolCalls.length > 0 ? "tool_calls" : "stop";

        if (process.env.DEBUG_SDK) {
          console.log("[SDK:emit]", JSON.stringify({ nativeToolCalls: nativeToolCalls.length, toolNames: nativeToolCalls.map(tc => tc.name) }));
        }

        const finishChunk: OpenAIStreamChunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created: nowUnix(),
          model,
          choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: stopReason }],
        };
        if (includeUsage && lastUsage) {
          finishChunk.usage = {
            prompt_tokens: lastUsage.input_tokens ?? 0,
            completion_tokens: lastUsage.output_tokens ?? 0,
            total_tokens:
              (lastUsage.input_tokens ?? 0) + (lastUsage.output_tokens ?? 0),
          };
        }
        safeEnqueue(`data: ${JSON.stringify(finishChunk)}\n\n`);
        safeEnqueue("data: [DONE]\n\n");
        if (process.env.DEBUG_SDK) {
          console.log("[SSE:done]", JSON.stringify({ requestId, stopReason, toolCalls: nativeToolCalls.length }));
        }
        safeClose();
      } catch (err) {
        if (!streamClosed) console.error("[SSE:error]", err);
        safeError(err);
      }
    },
    cancel() {
      streamClosed = true;
    },
  });
}
