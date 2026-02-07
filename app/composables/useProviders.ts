import { useConvexClient } from "convex-vue";
import { api } from "~~/convex/_generated/api";
import { dashboardFetch } from "~/utils/dashboard-fetch";

export function useProviders() {
  const convex = useConvexClient();
  const providers = ref<Array<Record<string, unknown>>>([]);
  const loading = ref(false);

  async function fetchProviders() {
    loading.value = true;
    try {
      const data = await convex.query(api.providers.queries.listByUser, {});
      providers.value = (data ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      console.error("Failed to fetch providers:", err);
    } finally {
      loading.value = false;
    }
  }

  async function createProvider(
    type: "claude-code" | "gemini" | "vertex-ai" | "openrouter",
    apiKey: string,
  ) {
    // Encrypt the API key server-side
    const encrypted = await dashboardFetch("/api/dashboard/providers", {
      method: "POST",
      body: { type, apiKey },
    }) as { encryptedApiKey: string; keyIv: string };

    // Store in Convex
    await convex.mutation(api.providers.mutations.create, {
      type,
      encryptedApiKey: encrypted.encryptedApiKey,
      keyIv: encrypted.keyIv,
    });

    await fetchProviders();
  }

  async function updateProvider(
    id: string,
    updates: { apiKey?: string },
  ) {
    const mutation: Record<string, unknown> = { id: id as never };

    if (updates.apiKey) {
      const encrypted = await dashboardFetch(`/api/dashboard/providers/${id}`, {
        method: "PUT",
        body: { apiKey: updates.apiKey },
      }) as { encryptedApiKey: string; keyIv: string };
      mutation.encryptedApiKey = encrypted.encryptedApiKey;
      mutation.keyIv = encrypted.keyIv;
    }

    await convex.mutation(api.providers.mutations.update, mutation as never);
    await fetchProviders();
  }

  async function removeProvider(id: string) {
    await convex.mutation(api.providers.mutations.remove, { id: id as never });
    await fetchProviders();
  }

  return { providers, loading, fetchProviders, createProvider, updateProvider, removeProvider };
}
