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
    const logs = await ctx.db
      .query("usageLogs")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    // Resolve API key names
    const keyIds = [...new Set(logs.map((l) => l.apiKeyId))];
    const keyMap = new Map<string, string>();
    for (const kid of keyIds) {
      try {
        const key = await ctx.db.get(kid as any);
        if (key && "name" in key) keyMap.set(kid, key.name as string);
      } catch {
        // key may have been deleted
      }
    }

    return logs.map((log) => ({
      ...log,
      apiKeyName: keyMap.get(log.apiKeyId),
    }));
  },
});
