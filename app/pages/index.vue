<template>
  <div class="bg-background text-foreground">
    <div class="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">
      <header
        class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
      >
        <div class="space-y-1">
          <p class="text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Starter
          </p>
          <h1 class="text-3xl font-semibold tracking-tight">
            Nuxt + Convex Auth
          </h1>
          <p class="max-w-xl text-sm text-muted-foreground">
            Sign in, confirm auth wiring works, and replace this view with your
            app.
          </p>
        </div>
        <div class="flex gap-2">
          <NuxtLink
            v-if="!isAuthenticated"
            to="/login"
            class="rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-sm transition hover:opacity-90"
          >
            Sign in
          </NuxtLink>
          <button
            v-else
            class="rounded-lg border border-destructive px-4 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:cursor-not-allowed"
            :disabled="isSigningOut"
            @click="handleSignOut"
          >
            {{ isSigningOut ? "Signing out…" : "Sign out" }}
          </button>
        </div>
      </header>

      <section class="rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div v-if="authLoading" class="space-y-3 text-muted-foreground">
          <p class="text-sm">Loading auth state…</p>
          <div class="h-2 w-32 animate-pulse rounded bg-muted" />
          <div class="h-2 w-48 animate-pulse rounded bg-muted" />
        </div>

        <div v-else-if="!isAuthenticated" class="space-y-4">
          <h2 class="text-xl font-semibold text-foreground">
            You are signed out
          </h2>
          <p class="text-sm text-muted-foreground">
            Start Google OAuth. Tokens stay local; we fetch your profile when
            you return.
          </p>
          <NuxtLink
            to="/login"
            class="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Continue with Google
          </NuxtLink>
        </div>

        <div v-else class="space-y-4">
          <div
            class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex items-center gap-4">
              <div
                class="flex h-14 w-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted"
              >
                <img
                  v-if="user?.image"
                  :src="user.image"
                  alt="User avatar"
                  class="h-full w-full object-cover"
                />
                <span
                  v-else
                  class="text-sm font-semibold text-muted-foreground"
                >
                  {{ userInitials }}
                </span>
              </div>
              <div class="space-y-1">
                <p
                  class="text-xs uppercase tracking-[0.2em] text-muted-foreground"
                >
                  Signed in as
                </p>
                <p class="text-xl font-semibold text-foreground">
                  {{ displayName }}
                </p>
                <p class="text-sm text-muted-foreground">{{ displayEmail }}</p>
              </div>
            </div>
          </div>

          <dl class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-xl border border-border bg-background p-4">
              <dt
                class="text-xs uppercase tracking-[0.15em] text-muted-foreground"
              >
                User id
              </dt>
              <dd class="mt-1 break-all font-mono text-sm text-foreground">
                {{ userId }}
              </dd>
            </div>
            <div class="rounded-xl border border-border bg-background p-4">
              <dt
                class="text-xs uppercase tracking-[0.15em] text-muted-foreground"
              >
                Email
              </dt>
              <dd class="mt-1 text-sm text-foreground">{{ displayEmail }}</dd>
            </div>
            <div class="rounded-xl border border-border bg-background p-4">
              <dt
                class="text-xs uppercase tracking-[0.15em] text-muted-foreground"
              >
                Verified
              </dt>
              <dd class="mt-1 text-sm text-foreground">
                {{ emailVerified ? "Yes" : "Not verified" }}
              </dd>
            </div>
            <div class="rounded-xl border border-border bg-background p-4">
              <dt
                class="text-xs uppercase tracking-[0.15em] text-muted-foreground"
              >
                Updated
              </dt>
              <dd class="mt-1 text-sm text-foreground">{{ updatedAtLabel }}</dd>
            </div>
            <div class="rounded-xl border border-border bg-background p-4">
              <dt
                class="text-xs uppercase tracking-[0.15em] text-muted-foreground"
              >
                Created
              </dt>
              <dd class="mt-1 text-sm text-foreground">{{ createdAtLabel }}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useConvexClient } from "convex-vue";
import { api } from "~~/convex/_generated/api";
import { authClient } from "~/lib/auth-client";
import { useConvexAuthState } from "@/composables/useConvexAuth";

interface UserRecord {
  _id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  emailVerified?: boolean | null;
}

const convex = useConvexClient();
const { isAuthenticated, isLoading } = useConvexAuthState();

const user = ref<UserRecord | null>(null);
const isSigningOut = ref(false);
const userLoading = ref(false);
const authLoading = computed(() => isLoading.value || userLoading.value);

const displayName = computed(
  () => user.value?.name?.trim() || "Name unavailable"
);
const displayEmail = computed(
  () => user.value?.email?.trim() || "Email unavailable"
);
const userId = computed(() => user.value?._id || "n/a");
const emailVerified = computed(() => Boolean(user.value?.emailVerified));

const formatDate = (timestamp?: number | null) => {
  if (!timestamp) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "—";
  }
};

const createdAtLabel = computed(() =>
  formatDate(user.value?.createdAt ?? null)
);
const updatedAtLabel = computed(() =>
  formatDate(user.value?.updatedAt ?? null)
);
const userInitials = computed(() => {
  const name = displayName.value;
  if (!name || name === "Name unavailable") return "U";
  return name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
});

const fetchUser = async () => {
  if (isLoading.value) return;

  if (!isAuthenticated.value) {
    user.value = null;
    return;
  }

  userLoading.value = true;
  try {
    const data = await convex.query(api.users.queries.currentUser, {});
    user.value = (data as UserRecord | null) ?? null;
  } catch (error) {
    console.error("[index] Failed to fetch user:", error);
    user.value = null;
  } finally {
    userLoading.value = false;
  }
};

const handleSignOut = async () => {
  if (isSigningOut.value) return;
  isSigningOut.value = true;

  try {
    await authClient.signOut();
  } catch (error) {
    console.error("[index] Failed to sign out:", error);
  } finally {
    user.value = null;
    isSigningOut.value = false;
  }
};

watch(
  () => isAuthenticated.value,
  () => {
    void fetchUser();
  },
  { immediate: true }
);
</script>
