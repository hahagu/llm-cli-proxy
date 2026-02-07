import { useConvexClient } from "convex-vue";
import { api } from "~~/convex/_generated/api";

export function useSystemPrompts() {
  const convex = useConvexClient();
  const prompts = ref<Array<Record<string, unknown>>>([]);
  const loading = ref(false);

  async function fetchPrompts() {
    loading.value = true;
    try {
      const data = await convex.query(api.systemPrompts.queries.listByUser, {});
      prompts.value = (data ?? []) as Array<Record<string, unknown>>;
    } catch (err) {
      console.error("Failed to fetch system prompts:", err);
    } finally {
      loading.value = false;
    }
  }

  async function createPrompt(
    name: string,
    content: string,
    isDefault: boolean,
    associatedModels?: string[],
  ) {
    await convex.mutation(api.systemPrompts.mutations.create, {
      name,
      content,
      isDefault,
      associatedModels,
    });
    await fetchPrompts();
  }

  async function updatePrompt(
    id: string,
    updates: {
      name?: string;
      content?: string;
      isDefault?: boolean;
      associatedModels?: string[];
    },
  ) {
    await convex.mutation(api.systemPrompts.mutations.update, {
      id: id as never,
      ...updates,
    } as never);
    await fetchPrompts();
  }

  async function removePrompt(id: string) {
    await convex.mutation(api.systemPrompts.mutations.remove, { id: id as never });
    await fetchPrompts();
  }

  return { prompts, loading, fetchPrompts, createPrompt, updatePrompt, removePrompt };
}
