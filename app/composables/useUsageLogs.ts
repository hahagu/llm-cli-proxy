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
  // Request metadata
  endpoint?: string;
  streamed?: boolean;
  messageCount?: number;
  hasTools?: boolean;
  temperature?: number;
  maxTokens?: number;
  stopReason?: string;
}

export function useUsageLogs() {
  const convex = useConvexClient();
  const logs = ref<UsageLog[]>([]);
  const loading = ref(true);
  const live = ref(false);

  let unsubscribe: (() => void) | null = null;

  function subscribe(limit = 200) {
    // Tear down any existing subscription
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    loading.value = true;
    live.value = true;

    const handle = convex.onUpdate(
      api.usageLogs.queries.listByUser,
      { limit },
      (result: unknown) => {
        logs.value = (result ?? []) as UsageLog[];
        loading.value = false;
      },
      (err: Error) => {
        console.error("Usage logs subscription error:", err);
        loading.value = false;
      },
    );

    unsubscribe = typeof handle === "function" ? handle : handle?.unsubscribe;
  }

  function stop() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    live.value = false;
  }

  // One-shot fetch fallback (used if subscription isn't desired)
  async function fetchLogs(limit = 200) {
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

  // Clean up on component unmount
  onScopeDispose(() => stop());

  return { logs, loading, live, subscribe, stop, fetchLogs };
}
