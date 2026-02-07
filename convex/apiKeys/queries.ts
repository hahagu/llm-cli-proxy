import { query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { authComponent } from "../auth";

export const listByUser = query({
  async handler(ctx) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("apiKeys")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const getByHash = query({
  args: { hashedKey: v.string() },
  async handler(ctx, args) {
    return ctx.db
      .query("apiKeys")
      .withIndex("by_hashedKey", (q) => q.eq("hashedKey", args.hashedKey))
      .first();
  },
});

export const getById = internalQuery({
  args: { id: v.id("apiKeys") },
  async handler(ctx, args) {
    return ctx.db.get(args.id);
  },
});

