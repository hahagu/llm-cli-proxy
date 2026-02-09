<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Provider</h1>
      <p class="text-sm text-muted-foreground">
        Connect your Claude account via OAuth.
      </p>
    </div>

    <Card class="max-w-lg">
      <CardHeader>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <Icon name="lucide:sparkles" class="h-4 w-4 text-purple-600 dark:text-purple-400" />
            </div>
            <CardTitle>Claude Code</CardTitle>
          </div>
          <div class="flex items-center gap-2">
            <Badge v-if="claudeCodeAvailable" variant="secondary">Connected</Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              as="a"
              href="https://claude.ai/settings"
              target="_blank"
            >
              <ExternalLink class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CardDescription>
          Claude models via OAuth authentication (Claude Max/Pro subscription).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <template v-if="claudeCodeLoading">
          <div class="flex items-center justify-center py-4">
            <div class="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        </template>
        <template v-else-if="claudeCodeAvailable">
          <div class="text-sm text-muted-foreground">
            Authenticated and ready. Claude models will be routed through this provider.
          </div>
          <div v-if="statusMessage" class="mt-2 text-xs" :class="statusError ? 'text-destructive' : 'text-green-600'">
            {{ statusMessage }}
          </div>
          <div class="mt-4 flex gap-2">
            <Button
              variant="outline"
              class="flex-1"
              :disabled="disconnecting"
              @click="handleDisconnect"
            >
              {{ disconnecting ? "Disconnecting..." : "Disconnect" }}
            </Button>
          </div>
        </template>
        <template v-else>
          <!-- Not connected: show auth flow -->
          <div v-if="!authUrl" class="space-y-3">
            <div class="text-sm text-muted-foreground">
              Not connected. Click below to start the authorization process.
            </div>
            <div v-if="statusMessage" class="text-xs" :class="statusError ? 'text-destructive' : 'text-green-600'">
              {{ statusMessage }}
            </div>
            <Button
              class="w-full"
              :disabled="connecting"
              @click="handleStartAuth"
            >
              {{ connecting ? "Starting..." : "Authenticate with Claude" }}
            </Button>
          </div>

          <!-- Auth URL generated: show instructions + paste field -->
          <div v-else class="space-y-3">
            <div class="text-sm text-muted-foreground">
              <strong>Step 1:</strong> Open the link below and authorize access.
            </div>
            <div class="flex gap-2">
              <Input
                :model-value="authUrl"
                readonly
                class="font-mono text-xs"
              />
              <Button variant="outline" size="icon" @click="copyAuthUrl">
                <Icon name="lucide:copy" class="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" as="a" :href="authUrl" target="_blank">
                <ExternalLink class="h-3.5 w-3.5" />
              </Button>
            </div>
            <div class="text-sm text-muted-foreground">
              <strong>Step 2:</strong> After authorizing, your browser will redirect to a localhost URL that won't load. Open your browser's DevTools Network tab to find the redirect URL and paste it below.
            </div>
            <div class="flex gap-2">
              <Input
                v-model="pastedUrl"
                placeholder="http://localhost:.../callback?code=...&state=..."
                class="font-mono text-xs"
              />
              <Button
                :disabled="!pastedUrl.trim() || exchanging"
                @click="handleExchange"
              >
                {{ exchanging ? "Connecting..." : "Connect" }}
              </Button>
            </div>
            <div v-if="statusMessage" class="text-xs" :class="statusError ? 'text-destructive' : 'text-green-600'">
              {{ statusMessage }}
            </div>
            <Button variant="ghost" size="sm" @click="authUrl = ''">
              Cancel
            </Button>
          </div>
        </template>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ExternalLink } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { useDashboardAuth } from "~/composables/useDashboardAuth";
import { dashboardFetch } from "~/utils/dashboard-fetch";

definePageMeta({ layout: "dashboard" });

const { isAuthenticated, isLoading: authLoading } = useDashboardAuth();

const claudeCodeLoading = ref(true);
const claudeCodeAvailable = ref(false);
const connecting = ref(false);
const disconnecting = ref(false);
const exchanging = ref(false);
const statusMessage = ref("");
const statusError = ref(false);
const authUrl = ref("");
const pastedUrl = ref("");

async function checkClaudeCodeStatus() {
  claudeCodeLoading.value = true;
  try {
    const data = await dashboardFetch<{ configured: boolean }>("/api/dashboard/claude-code-status");
    claudeCodeAvailable.value = data.configured;
  } catch {
    claudeCodeAvailable.value = false;
  } finally {
    claudeCodeLoading.value = false;
  }
}

async function handleStartAuth() {
  connecting.value = true;
  statusMessage.value = "";
  statusError.value = false;
  try {
    const data = await dashboardFetch<{ url: string }>("/api/dashboard/claude-code-auth/start");
    authUrl.value = data.url;
  } catch {
    statusMessage.value = "Failed to start authentication. Please make sure you're logged in.";
    statusError.value = true;
  } finally {
    connecting.value = false;
  }
}

async function handleExchange() {
  if (!pastedUrl.value.trim()) return;
  exchanging.value = true;
  statusMessage.value = "";
  statusError.value = false;
  try {
    const data = await dashboardFetch<{ success?: boolean; error?: string }>(
      "/api/dashboard/claude-code-auth/exchange",
      { method: "POST", body: { url: pastedUrl.value.trim() } },
    );
    if (data.success) {
      claudeCodeAvailable.value = true;
      authUrl.value = "";
      pastedUrl.value = "";
      statusMessage.value = "Successfully authenticated with Claude.";
      statusError.value = false;
      toast.success("Connected to Claude Code");
    } else {
      statusMessage.value = data.error || "Exchange failed.";
      statusError.value = true;
      authUrl.value = "";
      pastedUrl.value = "";
    }
  } catch (err: unknown) {
    const fetchErr = err as { data?: { error?: string } };
    statusMessage.value = fetchErr?.data?.error || "Failed to exchange authorization code.";
    statusError.value = true;
    authUrl.value = "";
    pastedUrl.value = "";
  } finally {
    exchanging.value = false;
  }
}

async function handleDisconnect() {
  disconnecting.value = true;
  try {
    await dashboardFetch("/api/dashboard/claude-code-auth/disconnect", { method: "POST" });
    claudeCodeAvailable.value = false;
    statusMessage.value = "Disconnected successfully.";
    statusError.value = false;
  } catch {
    statusMessage.value = "Failed to disconnect.";
    statusError.value = true;
  } finally {
    disconnecting.value = false;
  }
}

function copyAuthUrl() {
  navigator.clipboard.writeText(authUrl.value);
  toast.success("Copied to clipboard");
}

watch(
  [isAuthenticated, authLoading],
  ([authed, loading]) => {
    if (!loading && authed) {
      checkClaudeCodeStatus();
    }
  },
  { immediate: true },
);
</script>
