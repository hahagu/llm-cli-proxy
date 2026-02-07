import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const upsert = internalMutation({
  args: {
    userId: v.string(),
    encryptedAccessToken: v.string(),
    accessTokenIv: v.string(),
    encryptedRefreshToken: v.string(),
    refreshTokenIv: v.string(),
    expiresAt: v.optional(v.number()),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("claudeCodeTokens")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        encryptedAccessToken: args.encryptedAccessToken,
        accessTokenIv: args.accessTokenIv,
        encryptedRefreshToken: args.encryptedRefreshToken,
        refreshTokenIv: args.refreshTokenIv,
        expiresAt: args.expiresAt,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("claudeCodeTokens", {
        userId: args.userId,
        encryptedAccessToken: args.encryptedAccessToken,
        accessTokenIv: args.accessTokenIv,
        encryptedRefreshToken: args.encryptedRefreshToken,
        refreshTokenIv: args.refreshTokenIv,
        expiresAt: args.expiresAt,
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const remove = internalMutation({
  args: { userId: v.string() },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("claudeCodeTokens")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
