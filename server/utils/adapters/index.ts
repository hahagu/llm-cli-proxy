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

// Model prefix → provider type mapping for auto-routing
const MODEL_PREFIXES: Array<[string, string]> = [
  ["claude-", "claude-code"],
  ["gemini-", "gemini"],
  // OpenRouter models use org/model format
];

export function detectProviderFromModel(model: string): string | null {
  for (const [prefix, provider] of MODEL_PREFIXES) {
    if (model.startsWith(prefix)) return provider;
  }
  // Models with "/" are likely OpenRouter format (e.g., "anthropic/claude-3")
  if (model.includes("/")) return "openrouter";
  return null;
}
