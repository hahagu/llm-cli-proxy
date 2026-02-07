<template>
  <div class="bg-background text-foreground">
    <div class="mx-auto flex min-h-screen max-w-4xl items-center px-6 py-12">
      <div
        class="w-full space-y-6 rounded-2xl border border-border bg-card p-8 shadow-sm"
      >
        <div class="space-y-2">
          <p class="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Better Auth
          </p>
          <h1 class="text-3xl font-semibold tracking-tight">
            Sign in with Google
          </h1>
          <p class="text-sm text-muted-foreground">
            Click below to authenticate with your Google account.
          </p>
        </div>

        <button
          class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isLoading"
          @click="startSignIn"
        >
          {{ isLoading ? "Redirecting…" : "Continue with Google" }}
        </button>

        <p v-if="errorMessage" class="text-sm text-destructive">
          {{ errorMessage }}
        </p>

        <NuxtLink class="text-sm font-semibold text-primary underline" to="/">
          Back to home
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
import { useConvexAuthState } from "@/composables/useConvexAuth";

const router = useRouter();
const route = useRoute();
const { isAuthenticated } = useConvexAuthState();

const isLoading = ref(false);
const errorMessage = ref<string | null>(null);

// Handle error callback
if (route.query.error) {
  errorMessage.value = "Authentication failed. Please try again.";
}

// If already authenticated, redirect to home
watch(
  () => isAuthenticated.value,
  (signedIn) => {
    if (signedIn) {
      router.replace("/dashboard");
    }
  },
  { immediate: true }
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
      errorCallbackURL: `${origin}/login?error=oauth_failed`,
    });
  } catch (error) {
    console.error("[login] Failed to start sign in:", error);
    errorMessage.value = "Unable to start the OAuth flow. Check credentials.";
    isLoading.value = false;
  }
};
</script>
