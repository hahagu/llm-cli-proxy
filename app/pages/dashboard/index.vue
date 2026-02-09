<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <p class="text-sm text-muted-foreground">
        Overview of your LLM proxy configuration.
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">Claude Code</CardTitle>
          <Settings class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ claudeCodeAvailable ? "Connected" : "Not connected" }}</div>
          <p class="text-xs text-muted-foreground">OAuth status</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">API Keys</CardTitle>
          <KeyRound class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ activeKeyCount }}</div>
          <p class="text-xs text-muted-foreground">
            {{ keys.length }} total, {{ activeKeyCount }} active
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">System Prompts</CardTitle>
          <MessageSquare class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ prompts.length }}</div>
          <p class="text-xs text-muted-foreground">configured</p>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader>
        <CardTitle>Quick Start</CardTitle>
        <CardDescription>
          Get started with your LLM proxy in three steps.
        </CardDescription>
      </CardHeader>
      <CardContent class="space-y-4">
        <NuxtLink
          to="/dashboard/providers"
          class="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
        >
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            :class="
              claudeCodeAvailable
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            "
          >
            1
          </div>
          <div>
            <p class="text-sm font-medium">Connect Claude Code</p>
            <p class="text-xs text-muted-foreground">
              Authenticate with your Claude account.
            </p>
          </div>
        </NuxtLink>
        <NuxtLink
          to="/dashboard/api-keys"
          class="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
        >
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            :class="
              activeKeyCount > 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            "
          >
            2
          </div>
          <div>
            <p class="text-sm font-medium">Generate an API Key</p>
            <p class="text-xs text-muted-foreground">
              Create an API key to authenticate requests to the proxy.
            </p>
          </div>
        </NuxtLink>
        <NuxtLink
          to="/dashboard/chat"
          class="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
        >
          <div
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            :class="
              activeKeyCount > 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            "
          >
            3
          </div>
          <div>
            <p class="text-sm font-medium">Test Your Setup</p>
            <p class="text-xs text-muted-foreground">
              Send a test message through the proxy to verify everything works.
            </p>
          </div>
        </NuxtLink>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { KeyRound, Settings, MessageSquare } from "lucide-vue-next";
import { useApiKeys } from "~/composables/useApiKeys";
import { useSystemPrompts } from "~/composables/useSystemPrompts";
import { dashboardFetch } from "~/utils/dashboard-fetch";

definePageMeta({ layout: "dashboard" });

const { keys, fetchKeys } = useApiKeys();
const { prompts, fetchPrompts } = useSystemPrompts();

const claudeCodeAvailable = ref(false);

const activeKeyCount = computed(
  () => keys.value.filter((k) => k.isActive).length,
);

onMounted(() => {
  fetchKeys();
  fetchPrompts();
  dashboardFetch<{ configured: boolean }>("/api/dashboard/claude-code-status")
    .then((data) => { claudeCodeAvailable.value = data.configured; })
    .catch(() => { /* ignore */ });
});
</script>
