import type { ProviderAdapter } from "./types";
import { ClaudeCodeAdapter } from "./claude-code";
import { GeminiAdapter } from "./gemini";
import { OpenRouterAdapter } from "./openrouter";

const adapters: Record<string, ProviderAdapter> = {
  "claude-code": new ClaudeCodeAdapter(),
  gemini: new GeminiAdapter(),
  openrouter: new OpenRouterAdapter(),
};

export function getAdapter(providerType: string): ProviderAdapter {
  const adapter = adapters[providerType];
  if (!adapter) throw new Error(`Unknown provider: ${providerType}`);
  return adapter;
}

export function detectProviderFromModel(model: string): string | null {
  if (model.startsWith("claude-")) return "claude-code";
  if (model.startsWith("gemini-")) return "gemini";
  // OpenRouter models use org/model format (e.g., "anthropic/claude-3")
  if (model.includes("/")) return "openrouter";
  return null;
}
