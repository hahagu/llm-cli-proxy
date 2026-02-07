import { query } from "../_generated/server";
import { v } from "convex/values";
import { authComponent } from "../auth";

export const listByUser = query({
  async handler(ctx) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("providers")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const getByUserAndType = query({
  args: {
    userId: v.string(),
    type: v.union(
      v.literal("claude-code"),
      v.literal("gemini"),
      v.literal("vertex-ai"),
      v.literal("openrouter"),
    ),
  },
  async handler(ctx, args) {
    return ctx.db
      .query("providers")
      .withIndex("by_userId_type", (q) =>
        q.eq("userId", args.userId).eq("type", args.type),
      )
      .first();
  },
});

export const listByUserId = query({
  args: { userId: v.string() },
  async handler(ctx, args) {
    return ctx.db
      .query("providers")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});
