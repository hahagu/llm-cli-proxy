import { mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { authComponent } from "../auth";

export const create = internalMutation({
  args: {
    userId: v.string(),
    hashedKey: v.string(),
    keyPrefix: v.string(),
    name: v.string(),
    rateLimitPerMinute: v.optional(v.number()),
  },
  async handler(ctx, args) {
    return ctx.db.insert("apiKeys", {
      userId: args.userId,
      hashedKey: args.hashedKey,
      keyPrefix: args.keyPrefix,
      name: args.name,
      isActive: true,
      createdAt: Date.now(),
      rateLimitPerMinute: args.rateLimitPerMinute,
    });
  },
});

export const deactivate = mutation({
  args: { id: v.id("apiKeys") },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");
    const key = await ctx.db.get(args.id);
    if (!key || key.userId !== user._id) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: false });
  },
});

export const activate = mutation({
  args: { id: v.id("apiKeys") },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");
    const key = await ctx.db.get(args.id);
    if (!key || key.userId !== user._id) throw new Error("Not found");
    await ctx.db.patch(args.id, { isActive: true });
  },
});

export const remove = mutation({
  args: { id: v.id("apiKeys") },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");
    const key = await ctx.db.get(args.id);
    if (!key || key.userId !== user._id) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});

export const updateLastUsed = internalMutation({
  args: { id: v.id("apiKeys") },
  async handler(ctx, args) {
    await ctx.db.patch(args.id, { lastUsedAt: Date.now() });
  },
});
