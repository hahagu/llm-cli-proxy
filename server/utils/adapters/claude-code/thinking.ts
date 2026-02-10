/**
 * Thinking / reasoning mode support for the Claude Code adapter.
 *
 * Maps OpenAI-style `reasoning_effort` and Anthropic-style `thinking`
 * parameters to prompt-based <thinking> tags. The model writes its
 * reasoning inside these tags, and the streaming layer routes the
 * content to `reasoning_content` in the OpenAI delta format.
 */

import type { OpenAIChatRequest } from "../types";

/** Thinking mode resolved from request parameters. */
export type ThinkingMode = "off" | "forced" | "adaptive";

/** Effort level for thinking depth. */
export type ThinkingEffort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Resolve thinking mode from request parameters. */
export function resolveThinkingMode(request: OpenAIChatRequest): ThinkingMode {
  // Explicit Anthropic-style thinking
  if (request.thinking?.type === "enabled") return "forced";
  if (request.thinking?.type === "adaptive") return "adaptive";
  if (request.thinking?.type === "disabled") return "off";

  // OpenAI-style reasoning_effort
  if (request.reasoning_effort && request.reasoning_effort !== "none") return "forced";

  return "off";
}

/** Resolve effort level from request. */
export function resolveThinkingEffort(request: OpenAIChatRequest): ThinkingEffort {
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
export function buildThinkingPrompt(mode: ThinkingMode, effort: ThinkingEffort): string {
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
export function extractThinkingFromText(text: string): {
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
