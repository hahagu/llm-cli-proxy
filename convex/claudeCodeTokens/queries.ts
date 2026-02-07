import { query, internalQuery } from "../_generated/server";
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

export const listAll = internalQuery({
  args: {},
  async handler(ctx) {
    return ctx.db.query("claudeCodeTokens").collect();
  },
});
