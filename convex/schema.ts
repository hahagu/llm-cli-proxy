import { defineSchema } from "convex/server";
import { users } from "./schemas/users";
import { apiKeys } from "./schemas/apiKeys";
import { providers } from "./schemas/providers";
import { systemPrompts } from "./schemas/systemPrompts";
import { usageLogs } from "./schemas/usageLogs";
import { claudeCodeTokens } from "./schemas/claudeCodeTokens";

export default defineSchema({
  users,
  apiKeys,
  providers,
  systemPrompts,
  usageLogs,
  claudeCodeTokens,
});
