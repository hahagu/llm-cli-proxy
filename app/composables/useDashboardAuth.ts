import { useConvexAuthState } from "./useConvexAuth";

export function useDashboardAuth() {
  const { isAuthenticated, isLoading, user } = useConvexAuthState();
  const router = useRouter();

  watch(
    [isAuthenticated, isLoading],
    ([authed, loading]) => {
      if (!loading && !authed) {
        router.replace("/login");
      }
    },
    { immediate: true },
  );

  return { isAuthenticated, isLoading, user };
}
