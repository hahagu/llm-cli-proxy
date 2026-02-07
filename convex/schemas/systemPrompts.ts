import { defineTable } from "convex/server";
import { v } from "convex/values";

export const systemPrompts = defineTable({
  userId: v.string(),
  name: v.string(),
  content: v.string(),
  isDefault: v.boolean(),
  associatedModels: v.optional(v.array(v.string())),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_userId", ["userId"])
  .index("by_userId_default", ["userId", "isDefault"]);
