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

/**
 * Parse a model string that may include a provider prefix (e.g. "claude-code:claude-opus-4-6").
 * Returns the provider type and the raw model ID to send to the upstream API.
 */
export function parseModelWithProvider(model: string): { provider: string; model: string } | null {
  // Explicit prefix format: "provider:model"
  const colonIdx = model.indexOf(":");
  if (colonIdx > 0) {
    const prefix = model.slice(0, colonIdx);
    const rawModel = model.slice(colonIdx + 1);
    if (adapters[prefix] && rawModel) {
      return { provider: prefix, model: rawModel };
    }
  }

  // Fallback to heuristic detection
  const provider = detectProviderHeuristic(model);
  if (provider) return { provider, model };
  return null;
}

function detectProviderHeuristic(model: string): string | null {
  if (model.startsWith("claude-")) return "claude-code";
  if (model.startsWith("gemini-")) return "gemini";
  // OpenRouter models use org/model format (e.g., "anthropic/claude-3")
  if (model.includes("/")) return "openrouter";
  return null;
}

const providerDisplayNames: Record<string, string> = {
  "claude-code": "Claude Code",
  gemini: "Gemini",
  openrouter: "OpenRouter",
};

export function getProviderDisplayPrefix(providerType: string): string {
  return providerDisplayNames[providerType] ?? providerType;
}

export function detectProviderFromModel(model: string): string | null {
  const parsed = parseModelWithProvider(model);
  return parsed?.provider ?? null;
}
