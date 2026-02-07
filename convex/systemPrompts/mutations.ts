import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { authComponent } from "../auth";

export const create = mutation({
  args: {
    name: v.string(),
    content: v.string(),
    isDefault: v.boolean(),
    associatedModels: v.optional(v.array(v.string())),
  },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");

    if (args.isDefault) {
      const existingDefaults = await ctx.db
        .query("systemPrompts")
        .withIndex("by_userId_default", (q) =>
          q.eq("userId", user._id).eq("isDefault", true),
        )
        .collect();
      for (const prompt of existingDefaults) {
        await ctx.db.patch(prompt._id, { isDefault: false });
      }
    }

    const now = Date.now();
    return ctx.db.insert("systemPrompts", {
      userId: user._id,
      name: args.name,
      content: args.content,
      isDefault: args.isDefault,
      associatedModels: args.associatedModels,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("systemPrompts"),
    name: v.optional(v.string()),
    content: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    associatedModels: v.optional(v.array(v.string())),
  },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");
    const prompt = await ctx.db.get(args.id);
    if (!prompt || prompt.userId !== user._id) throw new Error("Not found");

    if (args.isDefault) {
      const existingDefaults = await ctx.db
        .query("systemPrompts")
        .withIndex("by_userId_default", (q) =>
          q.eq("userId", user._id).eq("isDefault", true),
        )
        .collect();
      for (const p of existingDefaults) {
        if (p._id !== args.id) {
          await ctx.db.patch(p._id, { isDefault: false });
        }
      }
    }

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) updates.name = args.name;
    if (args.content !== undefined) updates.content = args.content;
    if (args.isDefault !== undefined) updates.isDefault = args.isDefault;
    if (args.associatedModels !== undefined) updates.associatedModels = args.associatedModels;

    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("systemPrompts") },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) throw new Error("Unauthorized");
    const prompt = await ctx.db.get(args.id);
    if (!prompt || prompt.userId !== user._id) throw new Error("Not found");
    await ctx.db.delete(args.id);
  },
});
