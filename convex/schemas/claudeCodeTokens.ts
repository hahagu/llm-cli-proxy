import { defineTable } from "convex/server";
import { v } from "convex/values";

export const claudeCodeTokens = defineTable({
  userId: v.string(),
  encryptedAccessToken: v.string(),
  accessTokenIv: v.string(),
  encryptedRefreshToken: v.string(),
  refreshTokenIv: v.string(),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_userId", ["userId"]);
