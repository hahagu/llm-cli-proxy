import { defineTable } from "convex/server";
import { v } from "convex/values";

export const apiKeys = defineTable({
  userId: v.string(),
  hashedKey: v.string(),
  keyPrefix: v.string(),
  name: v.string(),
  isActive: v.boolean(),
  lastUsedAt: v.optional(v.number()),
  createdAt: v.number(),
  rateLimitPerMinute: v.optional(v.number()),
})
  .index("by_hashedKey", ["hashedKey"])
  .index("by_userId", ["userId"]);
