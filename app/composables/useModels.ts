import { dashboardFetch } from "~/utils/dashboard-fetch";

export function useModels() {
  const models = ref<Array<{ id: string; owned_by: string; name?: string }>>([]);
  const loading = ref(false);

  async function fetchModels() {
    loading.value = true;
    try {
      const data = await dashboardFetch<{
        models: Array<{ id: string; owned_by: string; name?: string }>;
      }>("/api/dashboard/models");
      models.value = data.models;
    } catch (err) {
      console.error("Failed to fetch models:", err);
      models.value = [];
    } finally {
      loading.value = false;
    }
  }

  return { models, loading, fetchModels };
}
