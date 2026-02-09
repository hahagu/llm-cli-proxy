import type { ProviderAdapter } from "./types";
import { ClaudeCodeAdapter } from "./claude-code";

const adapter = new ClaudeCodeAdapter();

export function getAdapter(): ProviderAdapter {
  return adapter;
}
