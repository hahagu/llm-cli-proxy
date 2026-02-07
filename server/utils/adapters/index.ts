import type { ProviderAdapter } from "./types";
import { ClaudeCodeAdapter } from "./claude-code";
import { GeminiAdapter } from "./gemini";
import { OpenRouterAdapter } from "./openrouter";
import { VertexAiAdapter } from "./vertex-ai";

const adapters: Record<string, ProviderAdapter> = {
  "claude-code": new ClaudeCodeAdapter(),
  gemini: new GeminiAdapter(),
  "vertex-ai": new VertexAiAdapter(),
  openrouter: new OpenRouterAdapter(),
};

export function getAdapter(providerType: string): ProviderAdapter {
  const adapter = adapters[providerType];
  if (!adapter) throw new Error(`Unknown provider: ${providerType}`);
  return adapter;
}

// Model prefix → candidate provider types (ordered by preference)
const MODEL_PROVIDERS: Array<[string, string[]]> = [
  ["claude-", ["claude-code"]],
  ["gemini-", ["vertex-ai", "gemini"]],
  // OpenRouter models use org/model format
];

/**
 * Returns an ordered list of candidate provider types for a given model.
 * The caller should try each until it finds one with configured credentials.
 */
export function detectProvidersFromModel(model: string): string[] {
  for (const [prefix, providers] of MODEL_PROVIDERS) {
    if (model.startsWith(prefix)) return providers;
  }
  // Models with "/" are likely OpenRouter format (e.g., "anthropic/claude-3")
  if (model.includes("/")) return ["openrouter"];
  return [];
}
