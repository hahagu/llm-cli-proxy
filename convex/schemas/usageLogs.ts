import { defineTable } from "convex/server";
import { v } from "convex/values";

export const usageLogs = defineTable({
  userId: v.string(),
  apiKeyId: v.string(),
  providerType: v.string(),
  model: v.string(),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  latencyMs: v.number(),
  statusCode: v.number(),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
  // Request metadata
  endpoint: v.optional(v.string()),
  streamed: v.optional(v.boolean()),
  messageCount: v.optional(v.number()),
  hasTools: v.optional(v.boolean()),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  stopReason: v.optional(v.string()),
})
  .index("by_userId", ["userId"])
  .index("by_apiKeyId", ["apiKeyId"])
  .index("by_createdAt", ["createdAt"]);
