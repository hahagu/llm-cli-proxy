import { useConvexClient } from "convex-vue";
import { api } from "~~/convex/_generated/api";

export interface UsageLog {
  _id: string;
  userId: string;
  apiKeyId: string;
  providerType: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  statusCode: number;
  errorMessage?: string;
  createdAt: number;
  apiKeyName?: string;
}

export function useUsageLogs() {
  const convex = useConvexClient();
  const logs = ref<UsageLog[]>([]);
  const loading = ref(false);

  async function fetchLogs(limit = 100) {
    loading.value = true;
    try {
      const data = await convex.query(api.usageLogs.queries.listByUser, { limit });
      logs.value = (data ?? []) as UsageLog[];
    } catch (err) {
      console.error("Failed to fetch usage logs:", err);
    } finally {
      loading.value = false;
    }
  }

  return { logs, loading, fetchLogs };
}
