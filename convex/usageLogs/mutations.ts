import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const insert = internalMutation({
  args: {
    userId: v.string(),
    apiKeyId: v.string(),
    providerType: v.string(),
    model: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    latencyMs: v.number(),
    statusCode: v.number(),
    errorMessage: v.optional(v.string()),
    endpoint: v.optional(v.string()),
    streamed: v.optional(v.boolean()),
    messageCount: v.optional(v.number()),
    hasTools: v.optional(v.boolean()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    stopReason: v.optional(v.string()),
  },
  async handler(ctx, args) {
    return ctx.db.insert("usageLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
