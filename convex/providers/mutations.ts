import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { authComponent } from "../auth";

export const create = mutation({
  args: {
    type: v.union(
      v.literal("claude-code"),
      v.literal("gemini"),
      v.literal("vertex-ai"),
      v.literal("openrouter"),
    ),
    encryptedApiKey: v.string(),
    keyIv: v.string(),
    defaultSystemPromptId: v.optional(v.id("systemPrompts")),
  },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");

    const existing = await ctx.db
      .query("providers")
      .withIndex("by_userId_type", (q) =>
        q.eq("userId", user._id).eq("type", args.type),
      )
      .first();
    if (existing) {
      throw new Error(`Provider ${args.type} already configured. Update it instead.`);
    }

    const now = Date.now();
    return ctx.db.insert("providers", {
      userId: user._id,
      type: args.type,
      encryptedApiKey: args.encryptedApiKey,
      keyIv: args.keyIv,
      defaultSystemPromptId: args.defaultSystemPromptId,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("providers"),
    encryptedApiKey: v.optional(v.string()),
    keyIv: v.optional(v.string()),
    defaultSystemPromptId: v.optional(v.id("systemPrompts")),
  },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");
    const provider = await ctx.db.get(args.id);
    if (!provider || provider.userId !== user._id) throw new Error("Not found");

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.encryptedApiKey !== undefined) updates.encryptedApiKey = args.encryptedApiKey;
    if (args.keyIv !== undefined) updates.keyIv = args.keyIv;
    if (args.defaultSystemPromptId !== undefined) updates.defaultSystemPromptId = args.defaultSystemPromptId;

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("providers") },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");
    const provider = await ctx.db.get(args.id);
    if (!provider || provider.userId !== user._id) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});
