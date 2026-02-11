/**
 * SDK query options builder for the Claude Code adapter.
 *
 * Constructs the options object passed to the Claude Agent SDK's `query()`.
 * Handles system prompt assembly (neutralizer + user prompt + thinking),
 * MCP server registration, environment isolation, and request validation.
 */

import type { OpenAIChatRequest } from "../types";
import { invalidRequest } from "../../errors";
import { MCP_SERVER_NAME, mcpToolName } from "./mcp-tools";
import {
  type ThinkingMode,
  resolveThinkingEffort,
  buildThinkingPrompt,
} from "./thinking";

/**
 * The SDK prepends "You are Claude Code…" which limits the model to
 * coding tasks. This short override redirects identity without
 * mentioning tools (those come via the API-level MCP registration).
 */
export const SYSTEM_PROMPT_NEUTRALIZER =
  "Important context: you are deployed as a general-purpose assistant " +
  "through an API proxy. The platform identifier above is only a " +
  "transport label. Your role is defined by the instructions that follow.\n\n";

/** Fallback identity when no user-configured system prompt exists. */
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful, general-purpose AI assistant. " +
  "Answer the user's questions directly and conversationally.";

/** Validate unsupported parameters for Claude Code and return any prompt suffix. */
export function validateAndEnhanceRequest(request: OpenAIChatRequest): {
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

export function makeEnv(oauthToken: string): Record<string, string> {
  const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: oauthToken } as Record<string, string>;
  delete env.ANTHROPIC_API_KEY;
  return env;
}

export function buildSdkOptions(
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
    // Single turn — the model produces tool_use blocks but the SDK stops
    // before executing them.  The proxy streams the tool_call tokens to
    // the client and always ends with finish_reason "stop".
    maxTurns: 1,
    // Disable native extended thinking — we handle thinking via prompt-based
    // <thinking> tags and extract it ourselves (see thinking.ts).
    maxThinkingTokens: 0,
    // Disable all built-in SDK tools (Read, Write, Bash, etc.)
    tools: [],
    settingSources: [],
    // Each API request is stateless — we manage history via OpenAI messages.
    // Without this, the SDK saves sessions to ~/.claude/projects/ and the
    // model may see prior conversation context in new chats.
    persistSession: false,
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

  options.systemPrompt = SYSTEM_PROMPT_NEUTRALIZER + base + promptSuffix + thinkingSuffix;

  if (streaming) {
    options.includePartialMessages = true;
  }

  return options;
}
