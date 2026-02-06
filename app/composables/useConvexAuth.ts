import { authClient } from "~/lib/auth-client";
import { computed } from "vue";

export function useConvexAuthState() {
  const session = authClient.useSession();

  return {
    isAuthenticated: computed(() => !!session.value?.data?.user),
    isLoading: computed(() => session.value?.isPending ?? true),
    user: computed(() => session.value?.data?.user ?? null),
  };
}
