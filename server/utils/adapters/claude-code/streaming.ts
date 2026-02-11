/**
 * SSE streaming for the Claude Code adapter.
 *
 * Creates a ReadableStream<string> that translates Claude Agent SDK
 * stream events into OpenAI-compatible SSE chunks. Handles:
 *
 * - Text delta streaming (including thinking tag detection)
 * - Deferred tool_call emission (init sent with first real arg fragment)
 * - Assistant message backfill for tool calls with no streamed args
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
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

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

      // SSE comment keepalive — keeps the TCP connection alive during
      // gaps between content_block_start and the first arg fragment.
      function startKeepalive() {
        if (keepaliveTimer) return;
        keepaliveTimer = setInterval(() => {
          safeEnqueue(": keepalive\n\n");
        }, 5_000);
      }
      function stopKeepalive() {
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
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
        // All tool calls seen so far (across all turns).
        const nativeToolCalls: Array<{ rawId: string; id: string; name: string; index: number; emitted: boolean }> = [];
        let currentToolUse: { rawId: string; id: string; name: string; index: number; emitted: boolean } | null = null;

        /** Emit the OpenAI init chunk (id/type/name + arguments) for a tool call. */
        function emitToolCallInit(tc: { id: string; name: string; index: number }, args: string) {
          const chunk: OpenAIStreamChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: nowUnix(),
            model,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: tc.index,
                  id: tc.id,
                  type: "function",
                  function: { name: tc.name, arguments: args },
                }],
              },
              logprobs: null,
              finish_reason: null,
            }],
          };
          safeEnqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        }

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
              if (ev?.type === "content_block_delta") {
                const dt = ev?.delta?.type;
                // Log input_json_delta (first occurrence per tool) to
                // confirm arg streaming is working; skip noisy text deltas.
                if (dt === "input_json_delta") {
                  summary.eventType = ev.type;
                  summary.deltaType = dt;
                  summary.fragmentLen = (ev?.delta?.partial_json ?? "").length;
                  logIt = true;
                }
              } else {
                summary.eventType = ev?.type;
                if (ev?.type === "content_block_start") summary.blockType = ev?.content_block?.type;
                logIt = true;
              }
            }
            if (message.type === "assistant") {
              const blocks = (message as any).message?.content;
              summary.blocks = blocks?.map((b: any) => ({
                type: b.type,
                ...(b.name ? { name: b.name } : {}),
                ...(b.type === "tool_use" ? { id: b.id, hasInput: !!b.input && Object.keys(b.input).length > 0 } : {}),
              }));
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
                currentToolUse = { rawId, id: callId, name: toolName, index: toolIndex, emitted: false };
                // Don't emit init yet — defer until first non-empty
                // arg fragment so LobeChat never sees a tool call
                // without argument data.  Keepalive bridges the gap.
                startKeepalive();

                if (process.env.DEBUG_SDK) {
                  console.log("[SDK:tool_use:start]", JSON.stringify({ id: callId, name: toolName, rawId, rawName: block.name }));
                }
              }
            }

            // --- content_block_delta: stream tool arg fragments or text ---
            if (event.type === "content_block_delta") {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === "input_json_delta" && currentToolUse) {
                stopKeepalive();
                const fragment = (delta.partial_json as string) ?? "";
                if (!fragment) {
                  // Skip empty fragments (SDK "start" signal).
                } else if (!currentToolUse.emitted) {
                  // First real data — emit init + first arg together.
                  currentToolUse.emitted = true;
                  emitToolCallInit(currentToolUse, fragment);
                } else {
                  // Subsequent fragments — just the args.
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
                }
              } else if (delta?.type === "text_delta" && delta.text) {
                feedText(delta.text as string);
              }
            }

            // --- content_block_stop: finalize tool_use, signal completion ---
            if (event.type === "content_block_stop") {
              if (currentToolUse) {
                stopKeepalive();
                nativeToolCalls.push({
                  rawId: currentToolUse.rawId,
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  index: currentToolUse.index,
                  emitted: currentToolUse.emitted,
                });
                if (process.env.DEBUG_SDK) {
                  console.log("[SDK:tool_use:complete]", JSON.stringify({
                    id: currentToolUse.id, name: currentToolUse.name, emitted: currentToolUse.emitted,
                  }));
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

          // --- assistant message: backfill args for tool calls that
          //     were never emitted (no non-empty input_json_delta) ---
          if (message.type === "assistant") {
            const blocks = ((message as any).message?.content ?? []) as Array<Record<string, unknown>>;
            if (process.env.DEBUG_SDK) {
              const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");
              const pending = nativeToolCalls.filter((t) => !t.emitted);
              console.log("[SDK:assistant:backfill-check]", JSON.stringify({
                toolUseBlocks: toolUseBlocks.length,
                pendingToolCalls: pending.map((t) => t.rawId),
                toolUseIds: toolUseBlocks.map((b) => b.id),
              }));
            }
            for (const block of blocks) {
              if (block.type !== "tool_use") continue;
              const rawId = block.id as string;
              // Match against tracked tool calls that haven't been emitted
              const tc = nativeToolCalls.find((t) => t.rawId === rawId && !t.emitted);
              if (!tc) continue;
              tc.emitted = true;
              const argsStr = JSON.stringify(block.input ?? {});
              emitToolCallInit(tc, argsStr);
              if (process.env.DEBUG_SDK) {
                console.log("[SDK:tool_use:backfill]", JSON.stringify({ id: tc.id, rawId, argsLen: argsStr.length }));
              }
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
        stopKeepalive();
        flushPending();

        // Safety net: emit any tool calls that never got args from
        // streaming or the assistant message (emit with empty args
        // so LobeChat at least sees the tool call).
        for (const tc of nativeToolCalls) {
          if (!tc.emitted) {
            tc.emitted = true;
            emitToolCallInit(tc, "{}");
            if (process.env.DEBUG_SDK) {
              console.log("[SDK:tool_use:fallback]", JSON.stringify({ id: tc.id, name: tc.name }));
            }
          }
        }

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
        stopKeepalive();
        if (!streamClosed) console.error("[SSE:error]", err);
        safeError(err);
      }
    },
    cancel() {
      streamClosed = true;
      stopKeepalive();
    },
  });
}
