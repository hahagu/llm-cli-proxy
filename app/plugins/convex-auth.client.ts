import { useConvexClient } from "convex-vue";
import { authClient } from "~/lib/auth-client";

export default defineNuxtPlugin(() => {
  const convex = useConvexClient();

  // Handle cross-domain one-time token from OAuth redirect
  const url = new URL(window.location.href);
  const ott = url.searchParams.get("ott");
  if (ott) {
    url.searchParams.delete("ott");
    const authClientWithCrossDomain = authClient as typeof authClient & {
      crossDomain: {
        oneTimeToken: {
          verify: (opts: { token: string }) => Promise<{
            data?: { session?: { token: string } };
          }>;
        };
      };
      updateSession: () => void;
    };
    authClientWithCrossDomain.crossDomain.oneTimeToken
      .verify({ token: ott })
      .then(async (result) => {
        const session = result.data?.session;
        if (session) {
          await authClient.getSession({
            fetchOptions: {
              headers: { Authorization: `Bearer ${session.token}` },
            },
          });
          authClientWithCrossDomain.updateSession();
        }
      });
    window.history.replaceState({}, "", url);
  }

  // Bridge better-auth session to Convex client
  let cachedToken: string | null = null;

  convex.setAuth(async (args: { forceRefreshToken: boolean }) => {
    if (cachedToken && !args.forceRefreshToken) {
      return cachedToken;
    }

    try {
      const { data } = await (authClient as any).convex.token();
      cachedToken = data?.token ?? null;
      return cachedToken;
    } catch {
      cachedToken = null;
      return null;
    }
  });

  // Re-trigger setAuth when session changes so Convex picks up new tokens
  const session = authClient.useSession();
  let lastSessionId: string | undefined;

  watch(
    () => session.value?.data?.session?.id,
    (newSessionId) => {
      if (newSessionId !== lastSessionId) {
        lastSessionId = newSessionId as string | undefined;
        cachedToken = null;
        convex.setAuth(async (args: { forceRefreshToken: boolean }) => {
          if (cachedToken && !args.forceRefreshToken) {
            return cachedToken;
          }
          try {
            const { data } = await (authClient as any).convex.token();
            cachedToken = data?.token ?? null;
            return cachedToken;
          } catch {
            cachedToken = null;
            return null;
          }
        });
      }
    },
  );
});
