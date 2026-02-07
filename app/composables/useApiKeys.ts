import { useConvexClient } from "convex-vue";
import { api } from "~~/convex/_generated/api";
import { dashboardFetch } from "~/utils/dashboard-fetch";

export function useApiKeys() {
  const convex = useConvexClient();
  const keys = ref<Array<Record<string, unknown>>>([]);
  const loading = ref(false);

  async function fetchKeys() {
    loading.value = true;
    try {
      const data = await convex.query(api.apiKeys.queries.listByUser, {});
      keys.value = (data ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      console.error("Failed to fetch API keys:", err);
    } finally {
      loading.value = false;
    }
  }

  async function generateKey(
    name: string,
    rateLimitPerMinute?: number,
  ) {
    const resp = await dashboardFetch("/api/dashboard/api-keys/generate", {
      method: "POST",
      body: { name, rateLimitPerMinute },
    });
    await fetchKeys();
    return resp as { key: string; prefix: string; name: string };
  }

  async function deactivateKey(id: string) {
    await convex.mutation(api.apiKeys.mutations.deactivate, { id: id as never });
    await fetchKeys();
  }

  async function activateKey(id: string) {
    await convex.mutation(api.apiKeys.mutations.activate, { id: id as never });
    await fetchKeys();
  }

  async function removeKey(id: string) {
    await convex.mutation(api.apiKeys.mutations.remove, { id: id as never });
    await fetchKeys();
  }

  return { keys, loading, fetchKeys, generateKey, deactivateKey, activateKey, removeKey };
}
