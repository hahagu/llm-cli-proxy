import { query } from "../_generated/server";
import { v } from "convex/values";

export const getByUserId = query({
  args: { userId: v.string() },
  async handler(ctx, args) {
    return ctx.db
      .query("claudeCodeTokens")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
  },
});
