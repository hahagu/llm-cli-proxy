import { dashboardFetch } from "~/utils/dashboard-fetch";

export function useModels() {
  const models = ref<Array<{ id: string; provider: string; owned_by: string }>>([]);
  const loading = ref(false);

  async function fetchModels(providerType?: string) {
    loading.value = true;
    try {
      const params = providerType ? `?providerType=${providerType}` : "";
      const data = await dashboardFetch<{
        models: Array<{ id: string; provider: string; owned_by: string }>;
      }>(`/api/dashboard/models${params}`);
      models.value = data.models;
    } catch (err) {
      console.error("Failed to fetch models:", err);
      models.value = [];
    } finally {
      loading.value = false;
    }
  }

  function getModelsForProvider(providerType: string) {
    return models.value.filter((m) => m.provider === providerType);
  }

  return { models, loading, fetchModels, getModelsForProvider };
}
