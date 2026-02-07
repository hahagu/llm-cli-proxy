<template>
  <div class="bg-background text-foreground">
    <div class="mx-auto flex min-h-screen max-w-md items-center px-6 py-12">
      <div v-if="authLoading" class="w-full text-center">
        <div class="space-y-3">
          <div class="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <p class="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>

      <div
        v-else-if="!isAuthenticated"
        class="w-full space-y-8"
      >
        <div class="space-y-3 text-center">
          <div class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Icon name="lucide:zap" class="h-7 w-7 text-primary" />
          </div>
          <h1 class="text-3xl font-semibold tracking-tight">
            LLM Proxy
          </h1>
          <p class="text-sm text-muted-foreground">
            Route LLM requests across multiple providers with a unified API.
          </p>
        </div>

        <div class="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <button
            class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="isLoading"
            @click="startSignIn"
          >
            {{ isLoading ? "Redirecting..." : "Continue with Google" }}
          </button>

          <p v-if="errorMessage" class="text-center text-sm text-destructive">
            {{ errorMessage }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
import { useConvexAuthState } from "@/composables/useConvexAuth";

const router = useRouter();
const route = useRoute();
const { isAuthenticated, isLoading: authLoading } = useConvexAuthState();

const isLoading = ref(false);
const errorMessage = ref<string | null>(null);

if (route.query.error) {
  errorMessage.value = "Authentication failed. Please try again.";
}

watch(
  () => isAuthenticated.value,
  (signedIn) => {
    if (signedIn) {
      router.replace("/dashboard");
    }
  },
  { immediate: true },
);

const startSignIn = async () => {
  if (isLoading.value) return;
  isLoading.value = true;
  errorMessage.value = null;

  try {
    const origin = window.location.origin;
    await authClient.signIn.social({
      provider: "google",
      callbackURL: `${origin}/dashboard`,
      errorCallbackURL: `${origin}/?error=oauth_failed`,
    });
  } catch (error) {
    console.error("[login] Failed to start sign in:", error);
    errorMessage.value = "Unable to start the OAuth flow. Check credentials.";
    isLoading.value = false;
  }
};
</script>
