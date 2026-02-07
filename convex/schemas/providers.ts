import { defineTable } from "convex/server";
import { v } from "convex/values";

export const providers = defineTable({
  userId: v.string(),
  type: v.union(
    v.literal("claude-code"),
    v.literal("gemini"),
    v.literal("openrouter"),
  ),
  encryptedApiKey: v.string(),
  keyIv: v.string(),
  defaultSystemPromptId: v.optional(v.id("systemPrompts")),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_userId_type", ["userId", "type"]);
