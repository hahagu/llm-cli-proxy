import { query } from "../_generated/server";
import { v } from "convex/values";
import { authComponent } from "../auth";

export const listByUser = query({
  async handler(ctx) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return [];
    return ctx.db
      .query("systemPrompts")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const getDefault = query({
  args: { userId: v.string() },
  async handler(ctx, args) {
    return ctx.db
      .query("systemPrompts")
      .withIndex("by_userId_default", (q) =>
        q.eq("userId", args.userId).eq("isDefault", true),
      )
      .first();
  },
});

export const getById = query({
  args: { id: v.id("systemPrompts") },
  async handler(ctx, args) {
    return ctx.db.get(args.id);
  },
});

/**
 * Get the best matching system prompt for a given model.
 * Priority: model-specific (associatedModels match) > global default (isDefault, no associatedModels)
 */
export const getForModel = query({
  args: { userId: v.string(), model: v.string() },
  async handler(ctx, args) {
    const allUserPrompts = await ctx.db
      .query("systemPrompts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    // Tier 2: model-specific prompt
    const modelSpecific = allUserPrompts.find(
      (p) => p.associatedModels && p.associatedModels.includes(args.model),
    );
    if (modelSpecific) return modelSpecific;

    // Tier 1: global default (isDefault=true with no/empty associatedModels)
    const globalDefault = allUserPrompts.find(
      (p) =>
        p.isDefault &&
        (!p.associatedModels || p.associatedModels.length === 0),
    );
    return globalDefault ?? null;
  },
});
