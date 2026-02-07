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
  },
  async handler(ctx, args) {
    return ctx.db.insert("usageLogs", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
