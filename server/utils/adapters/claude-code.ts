import type {
  ProviderAdapter,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIMessage,
  OpenAIModelEntry,
  OpenAIStreamChunk,
  OpenAIToolCall,
  OpenAITool,
} from "./types";
import { generateId, nowUnix } from "./types";
import { randomUUID } from "crypto";
import { mapProviderHttpError, providerError, invalidRequest } from "../errors";
import { z } from "zod";

/**
 * Claude Code adapter using the official Claude Agent SDK.
 *
 * Each request spawns a Claude Code CLI subprocess via the SDK's query().
 * The OAuth token is passed through CLAUDE_CODE_OAUTH_TOKEN env var,
 * ensuring per-user isolation (each query() call gets its own env).
 *
 * SDK limitations (these OpenAI params are NOT forwarded):
 *   temperature, top_p, max_tokens, stop, frequency_penalty, presence_penalty
 * The SDK controls its own API parameters internally.
 */

/**
 * The SDK prepends "You are Claude Code…" which limits the model to
 * coding tasks. This short override redirects identity without
 * mentioning tools (those come via the API-level MCP registration).
 */
const SYSTEM_PROMPT_NEUTRALIZER =
  "Important context: you are deployed as a general-purpose assistant " +
  "through an API proxy. The platform identifier above is only a " +
  "transport label. Your role is defined by the instructions that follow.\n\n";

/** Fallback identity when no user-configured system prompt exists. */
const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful, general-purpose AI assistant. " +
  "Answer the user's questions directly and conversationally.";

function extractTextContent(
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
function hasImageContent(messages: OpenAIMessage[]): boolean {
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
function convertMessagesMultimodal(request: OpenAIChatRequest): {
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
function createMultimodalPrompt(
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

// --- MCP-based tool calling ---

/** MCP server name used for proxied client tools. */
const MCP_SERVER_NAME = "proxy";

/** Prefix the SDK adds to MCP tool names: mcp__<server>__<tool> */
function mcpToolName(toolName: string): string {
  return `mcp__${MCP_SERVER_NAME}__${toolName}`;
}

/** Strip MCP prefix from a tool name to recover the original OpenAI name. */
function stripMcpPrefix(name: string): string {
  const prefix = `mcp__${MCP_SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * Recursively convert a JSON Schema property to a Zod type.
 * Handles nested objects, arrays with typed items, enums, and
 * all primitive types so the model sees the full parameter structure.
 */
function jsonSchemaPropertyToZod(
  prop: Record<string, unknown>,
): z.ZodTypeAny {
  const desc = prop.description as string | undefined;
  let zodType: z.ZodTypeAny;

  // Handle enum values (string enums)
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    const values = prop.enum as [string, ...string[]];
    zodType = z.enum(values);
    return desc ? zodType.describe(desc) : zodType;
  }

  switch (prop.type) {
    case "string":
      zodType = z.string();
      break;
    case "number":
    case "integer":
      zodType = z.number();
      break;
    case "boolean":
      zodType = z.boolean();
      break;
    case "array": {
      // Recursively convert items schema so nested structure is preserved
      const items = prop.items as Record<string, unknown> | undefined;
      const itemType = items ? jsonSchemaPropertyToZod(items) : z.any();
      zodType = z.array(itemType);
      break;
    }
    case "object": {
      // Recursively convert nested object properties
      const properties = prop.properties as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (properties) {
        const required = new Set((prop.required as string[]) ?? []);
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [name, propDef] of Object.entries(properties)) {
          const propZod = jsonSchemaPropertyToZod(propDef);
          shape[name] = required.has(name) ? propZod : propZod.optional();
        }
        zodType = z.object(shape);
      } else {
        zodType = z.record(z.any());
      }
      break;
    }
    default:
      zodType = z.any();
  }
  return desc ? zodType.describe(desc) : zodType;
}

/**
 * Convert an OpenAI function parameters JSON Schema to a Zod raw shape.
 * Preserves property names, basic types, descriptions, and required flags.
 */
function jsonSchemaToZodShape(
  schema: Record<string, unknown> | undefined,
): Record<string, z.ZodTypeAny> {
  if (!schema) return {};
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!props) return {};
  const required = new Set((schema.required as string[]) ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, prop] of Object.entries(props)) {
    const zodProp = jsonSchemaPropertyToZod(prop);
    shape[name] = required.has(name) ? zodProp : zodProp.optional();
  }
  return shape;
}

/**
 * Create an SDK MCP server that exposes the client's OpenAI tools as native
 * MCP tools. The model calls these via native tool_use (not prompt-based).
 * Handlers return a deferred marker — with maxTurns:1 the SDK stops before
 * the model sees the result, and we capture the tool_use from the stream.
 */
async function buildMcpServer(tools: OpenAITool[]) {
  const { createSdkMcpServer, tool: defineTool } = await import(
    "@anthropic-ai/claude-agent-sdk"
  );

  const mcpTools = tools.map((t) => {
    const shape = jsonSchemaToZodShape(
      t.function.parameters as Record<string, unknown> | undefined,
    );
    return defineTool(
      t.function.name,
      t.function.description ?? "",
      shape,
      async () => ({ content: [{ type: "text" as const, text: "[DEFERRED]" }] }),
    );
  });

  return createSdkMcpServer({
    name: MCP_SERVER_NAME,
    tools: mcpTools,
  });
}

/** Validate unsupported parameters for Claude Code and return any prompt suffix. */
function validateAndEnhanceRequest(request: OpenAIChatRequest): {
  promptSuffix: string;
  hasTools: boolean;
} {
  if (request.n && request.n > 1) {
    throw invalidRequest("Parameter 'n' > 1 is not supported for claude-code models.", "n");
  }

  let promptSuffix = "";
  const hasTools = !!(request.tools && request.tools.length > 0);

  // JSON mode via prompt
  if (request.response_format?.type === "json_object") {
    promptSuffix += "\n\nYou must respond with valid JSON only. No other text.";
  }

  return { promptSuffix, hasTools };
}

/**
 * Convert OpenAI messages into a systemPrompt + prompt pair.
 *
 * Conversation history is folded into the system prompt so the SDK's
 * single-turn `prompt` parameter only carries the current user input.
 * Tool calls and results use XML tags (<tool_call>, <tool_result>) that
 * mirror the native structure, helping the model maintain tool-use context
 * across follow-up turns.
 */
function convertMessages(request: OpenAIChatRequest): {
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
  // If the conversation ends with a user message, that becomes the prompt
  // and everything before it is folded into the system prompt as history.
  // If it ends with tool results (or assistant), ALL messages become history
  // and we use a continuation prompt.
  const lastMsg = msgs[msgs.length - 1];
  const endsWithUserMsg = lastMsg?.role === "user";

  // Index of the message that will become the SDK prompt (-1 = use continuation)
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
        // Skip the message that will become the prompt
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

  // Fold history into the system prompt
  if (historyParts.length > 0) {
    const history =
      "<conversation_history>\n" +
      historyParts.join("\n\n") +
      "\n</conversation_history>";
    systemPrompt = systemPrompt
      ? `${systemPrompt}\n\n${history}`
      : history;
  }

  // Determine the user-facing prompt
  const prompt =
    promptMsgIdx >= 0
      ? extractTextContent(msgs[promptMsgIdx]!.content)
      : "Continue with your task based on the conversation and tool results above.";

  return {
    systemPrompt: systemPrompt || undefined,
    prompt,
  };
}

function makeEnv(oauthToken: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  // Set OAuth token for the SDK subprocess
  env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
  // Prevent the SDK from using any ambient API key
  delete (env as Record<string, string | undefined>).ANTHROPIC_API_KEY;
  return env;
}

/** Thinking mode resolved from request parameters. */
type ThinkingMode = "off" | "forced" | "adaptive";

/** Effort level for thinking depth. */
type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Resolve thinking mode from request parameters. */
function resolveThinkingMode(request: OpenAIChatRequest): ThinkingMode {
  // Explicit Anthropic-style thinking
  if (request.thinking?.type === "enabled") return "forced";
  if (request.thinking?.type === "adaptive") return "adaptive";
  if (request.thinking?.type === "disabled") return "off";

  // OpenAI-style reasoning_effort
  if (request.reasoning_effort && request.reasoning_effort !== "none") return "forced";

  return "off";
}

/** Resolve effort level from request. */
function resolveThinkingEffort(request: OpenAIChatRequest): ThinkingEffort {
  if (request.reasoning_effort && request.reasoning_effort !== "none") {
    return request.reasoning_effort as ThinkingEffort;
  }
  return "medium";
}

/** Effort-specific depth instructions. */
const EFFORT_INSTRUCTIONS: Record<ThinkingEffort, string> = {
  minimal:
    "Keep your thinking brief — a few sentences identifying the key point and your approach.",
  low:
    "Think briefly — outline your main reasoning steps and key considerations in a short paragraph.",
  medium:
    "Think through the problem methodically. Break it into steps, consider different angles, " +
    "and show your reasoning chain before reaching a conclusion.",
  high:
    "Think deeply and thoroughly. Explore multiple perspectives, consider edge cases, weigh " +
    "trade-offs, challenge your initial assumptions, and build a detailed chain of reasoning. " +
    "Your thinking should be substantially longer than your final answer.",
  xhigh:
    "Think with maximum depth and rigor. Perform exhaustive analysis: explore all relevant angles, " +
    "consider counterarguments, examine edge cases, draw connections between concepts, question " +
    "assumptions, and reason through each step in detail. Produce a comprehensive chain of thought " +
    "that demonstrates thorough deliberation. Your thinking should be significantly longer than your answer.",
};

/** Build the thinking prompt suffix based on mode and effort. */
function buildThinkingPrompt(mode: ThinkingMode, effort: ThinkingEffort): string {
  if (mode === "off") return "";

  const depthInstruction = EFFORT_INSTRUCTIONS[effort];

  const coreInstruction =
    "Your thinking must focus on the SUBJECT MATTER of the user's question — " +
    "analyze the topic, reason about concepts, work through logic, and develop your answer. " +
    "Do NOT use the thinking section to discuss tool availability or your own capabilities.";

  if (mode === "adaptive") {
    return (
      "\n\nFor questions that benefit from careful reasoning, you may think through your " +
      "response inside <thinking>...</thinking> XML tags before answering. " +
      depthInstruction + " " + coreInstruction + " " +
      "Place your reasoning inside <thinking> tags, then provide your final answer AFTER the " +
      "closing </thinking> tag. The thinking section is shown separately to the user as your " +
      "reasoning process. For truly trivial questions, you may respond directly without thinking tags."
    );
  }

  // forced mode
  return (
    "\n\nIMPORTANT: Before answering, you MUST reason through the problem step-by-step " +
    "inside <thinking>...</thinking> XML tags. " +
    depthInstruction + " " + coreInstruction + " " +
    "Place ALL of your internal reasoning, analysis, and thought process inside these tags. " +
    "Then provide your final answer AFTER the closing </thinking> tag. The thinking section " +
    "is shown separately to the user as your reasoning process. " +
    "Always include the thinking tags, even for simple questions."
  );
}

/** Extract thinking content from text that uses <thinking>...</thinking> tags. */
function extractThinkingFromText(text: string): {
  thinking: string;
  content: string;
} {
  const match = text.match(/^[\s]*<thinking>([\s\S]*?)<\/thinking>([\s\S]*)$/);
  if (!match) {
    return { thinking: "", content: text };
  }
  return {
    thinking: match[1]!.trim(),
    content: match[2]!.trim(),
  };
}

// This proxy exposes the Claude model as a plain LLM — no native agent tools.
// Built-in SDK tools are disabled via `tools: []`.
// Client-provided tools are registered as native MCP tools so the model
// calls them via tool_use (not prompt-based JSON blocks).

function buildSdkOptions(
  request: OpenAIChatRequest,
  systemPrompt: string | undefined,
  promptSuffix: string,
  oauthToken: string,
  streaming: boolean,
  thinkingMode: ThinkingMode,
  mcpServer?: Record<string, unknown>,
) {
  const options: Record<string, unknown> = {
    model: request.model,
    // Single turn only — the client manages the tool loop via follow-up
    // requests.  With maxTurns:1 the model produces tool_use blocks but
    // the SDK stops before executing them, so we can capture and forward.
    maxTurns: 1,
    // Disable all built-in SDK tools (Read, Write, Bash, etc.)
    tools: [],
    settingSources: [],
    env: makeEnv(oauthToken),
  };

  // Register client tools as MCP tools
  if (mcpServer) {
    options.mcpServers = { [MCP_SERVER_NAME]: mcpServer };
    // Auto-approve all MCP tools so the model can call them without prompting
    const mcpToolNames = (request.tools ?? []).map((t) =>
      mcpToolName(t.function.name),
    );
    options.allowedTools = mcpToolNames;
  } else {
    options.allowedTools = [];
  }

  // The SDK always prepends "You are Claude Code…" before our prompt.
  // We neutralize that identity first, then append the caller's prompt
  // (or a plain default) so it takes full precedence.
  const base = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const effort = resolveThinkingEffort(request);
  const thinkingSuffix = buildThinkingPrompt(thinkingMode, effort);

  // When tools are available, nudge the model to provide complete arguments
  // matching the tool schema. Without this, the model sometimes calls tools
  // with empty {} arguments (especially for complex nested schemas).
  const toolHint = mcpServer
    ? "\n\nWhen calling tools, you must provide complete arguments that strictly " +
      "match each tool's parameter schema. Never call a tool with empty or partial arguments."
    : "";

  options.systemPrompt = SYSTEM_PROMPT_NEUTRALIZER + base + promptSuffix + toolHint + thinkingSuffix;

  if (streaming) {
    options.includePartialMessages = true;
  }

  return options;
}

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
            // Native tool_use block — capture for OpenAI tool_calls
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

    // Return native tool_use calls if found
    if (nativeToolCalls.length > 0) {
      const toolCalls: OpenAIToolCall[] = nativeToolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      }));
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
              tool_calls: toolCalls,
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
        },
      };
    }

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
        try {
          // Safe stream helpers — handle client disconnection gracefully.
          // When a client (e.g. LobeChat) closes the HTTP connection mid-stream,
          // the ReadableStream controller becomes closed and further enqueue()
          // calls throw "Controller is already closed". These wrappers catch
          // that and set a flag to suppress further writes.
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

          let sentRole = false;

          // --- Thinking tag detection state machine ---
          // When thinking is requested, detects <thinking>...</thinking> tags
          // inline and emits thinking content as reasoning_content in real-time.
          const OPEN_TAG = "<thinking>";
          const CLOSE_TAG = "</thinking>";
          type ThinkingState = "detect_start" | "in_thinking" | "detect_end" | "in_content" | "passthrough";
          let thinkingState: ThinkingState = wantsThinking ? "detect_start" : "passthrough";
          let tagBuffer = "";

          // --- Native tool_use tracking ---
          // Streams tool_use blocks to the client in real-time as OpenAI-format
          // tool_calls deltas, matching the incremental streaming format that
          // clients like LobeChat expect.
          const nativeToolCalls: Array<{ id: string; name: string }> = [];
          let currentToolUse: { id: string; name: string; index: number } | null = null;
          // Count message_start events to detect second turn (after tool execution).
          // Once the model enters a second turn, suppress text output since the
          // tool handler returned a placeholder and the model's response is irrelevant.
          let messageStartCount = 0;
          let suppressSecondTurn = false;


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


          /** Process incoming text through thinking tag detection, then route to content/tool handling */
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
                  // Found <thinking> — switch to streaming thinking content
                  thinkingState = "in_thinking";
                  const afterTag = trimmed.slice(OPEN_TAG.length);
                  tagBuffer = "";
                  if (afterTag) feedText(afterTag);
                } else {
                  // No thinking tag — flush buffer as content and passthrough
                  thinkingState = "passthrough";
                  const buf = tagBuffer;
                  tagBuffer = "";
                  emitTextDelta(buf);
                }
              } else if (trimmed.length > 0 && !OPEN_TAG.startsWith(trimmed)) {
                // Can't possibly match — flush as content
                thinkingState = "passthrough";
                const buf = tagBuffer;
                tagBuffer = "";
                emitTextDelta(buf);
              }
              // else: not enough data yet, keep buffering
              return;
            }

            if (thinkingState === "in_thinking") {
              tagBuffer += incoming;
              const closeIdx = tagBuffer.indexOf(CLOSE_TAG);
              if (closeIdx !== -1) {
                // Found </thinking> — emit everything before it as thinking, rest as content
                const thinkingContent = tagBuffer.slice(0, closeIdx);
                const afterTag = tagBuffer.slice(closeIdx + CLOSE_TAG.length);
                tagBuffer = "";
                thinkingState = "in_content";
                emitThinkingDelta(thinkingContent);
                if (afterTag) feedText(afterTag);
              } else {
                // No close tag yet — emit what's safe (keep last CLOSE_TAG.length-1 chars buffered)
                const safeLen = tagBuffer.length - (CLOSE_TAG.length - 1);
                if (safeLen > 0) {
                  emitThinkingDelta(tagBuffer.slice(0, safeLen));
                  tagBuffer = tagBuffer.slice(safeLen);
                }
              }
              return;
            }

            if (thinkingState === "in_content") {
              // After </thinking>, everything is regular content
              emitTextDelta(incoming);
              return;
            }
          }

          function flushPending() {
            // Flush any thinking buffer
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
            // Debug: log SDK messages (skip noisy text deltas)
            if (process.env.DEBUG_SDK) {
              let logIt = false;
              const summary: Record<string, unknown> = { type: message.type };
              if ("subtype" in message) { summary.subtype = (message as any).subtype; logIt = true; }
              if (message.type === "stream_event") {
                const ev = (message as any).event;
                // Skip noisy text deltas from logging (but still process them below)
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

              if (event.type === "message_start") {
                messageStartCount++;
                // If we already captured tool_use in the first turn,
                // suppress all output from subsequent turns (placeholder results)
                if (messageStartCount > 1 && nativeToolCalls.length > 0) {
                  suppressSecondTurn = true;
                }
                if (!sentRole) {
                  sentRole = true;
                  const chunk: OpenAIStreamChunk = {
                    id: requestId,
                    object: "chat.completion.chunk",
                    created: nowUnix(),
                    model,
                    choices: [
                      {
                        index: 0,
                        delta: { role: "assistant", content: "" },
                        logprobs: null,
                        finish_reason: null,
                      },
                    ],
                  };
                  safeEnqueue(`data: ${JSON.stringify(chunk)}\n\n`);
                } else if (!suppressSecondTurn) {
                  // Separator between multi-turn outputs
                  emitTextDelta("\n\n");
                }
              }

              // Stream native tool_use blocks as OpenAI-format tool_calls in real-time.
              // This matches the incremental streaming format clients expect:
              //   1. content_block_start → initial chunk with id, name, arguments:""
              //   2. content_block_delta → argument fragment chunks
              //   3. content_block_stop  → record completion (no extra emission)
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

                  // Emit initial tool_call chunk (id + name + empty arguments)
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
                    console.log("[SDK:tool_use:start]", JSON.stringify({ id: callId, name: toolName, rawId, rawName: block.name, hasId: "id" in block, hasName: "name" in block }));
                  }
                }
              }

              if (event.type === "content_block_delta") {
                const delta = event.delta as Record<string, unknown>;
                if (delta?.type === "input_json_delta" && currentToolUse) {
                  // Stream argument fragment to client
                  const fragment = (delta.partial_json as string) ?? "";
                  if (fragment) {
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
                } else if (delta?.type === "text_delta" && delta.text && !suppressSecondTurn) {
                  feedText(delta.text as string);
                }
              }

              if (event.type === "content_block_stop") {
                if (currentToolUse) {
                  nativeToolCalls.push({
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                  });
                  if (process.env.DEBUG_SDK) {
                    console.log("[SDK:tool_use:captured]", JSON.stringify({ id: currentToolUse.id, name: currentToolUse.name, index: currentToolUse.index }));
                  }
                  currentToolUse = null;
                }
              }

              if (event.type === "message_delta") {
                if (!suppressSecondTurn) flushPending();
                lastUsage = (event.usage as Record<string, number> | undefined) ?? lastUsage;
              }
            }

            if (message.type === "result") {
              if (message.subtype === "success" || message.subtype === "error_max_turns") {
                // Graceful stop — return whatever text was produced.
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
          if (!suppressSecondTurn) flushPending();

          // Tool calls were already streamed incrementally above.
          // Just determine the finish reason.
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
        // Client disconnected — mark stream as closed so the SDK loop
        // stops trying to enqueue data to the now-dead controller.
        streamClosed = true;
      },
    });
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
