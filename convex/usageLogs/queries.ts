import { query } from "../_generated/server";
import { v } from "convex/values";
import { authComponent } from "../auth";

export const listByUser = query({
  args: {
    limit: v.optional(v.number()),
  },
  async handler(ctx, args) {
    const user = await authComponent.getAuthUser(ctx);
    if (!user) return [];
    const limit = args.limit ?? 50;
    return ctx.db
      .query("usageLogs")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);
  },
});
