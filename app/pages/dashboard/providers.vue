<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Providers</h1>
      <p class="text-sm text-muted-foreground">
        Configure your LLM provider API keys.
      </p>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Claude Code: server-level OAuth -->
      <Card class="flex flex-col">
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
        <CardContent class="flex flex-1 flex-col">
          <template v-if="claudeCodeLoading">
            <div class="flex flex-1 items-center justify-center py-4">
              <div class="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          </template>
          <template v-else-if="claudeCodeAvailable">
            <div class="text-sm text-muted-foreground">
              Authenticated and ready. Claude models will be routed through this provider.
            </div>
            <div v-if="testResults['claude-code']" class="mt-2 text-xs" :class="testResults['claude-code'].success ? 'text-green-600' : 'text-destructive'">
              {{ testResults["claude-code"].message }}
            </div>
            <div v-if="claudeCodeMessage" class="mt-2 text-xs" :class="claudeCodeError ? 'text-destructive' : 'text-green-600'">
              {{ claudeCodeMessage }}
            </div>
            <div class="mt-auto flex gap-2 pt-4">
              <Button
                variant="outline"
                class="flex-1"
                :disabled="testing['claude-code']"
                @click="handleTest('claude-code')"
              >
                {{ testing["claude-code"] ? "Testing..." : "Test Connection" }}
              </Button>
              <Button
                variant="outline"
                class="flex-1"
                :disabled="disconnecting"
                @click="handleDisconnectClaudeCode"
              >
                {{ disconnecting ? "Disconnecting..." : "Disconnect" }}
              </Button>
            </div>
          </template>
          <template v-else>
            <div class="text-sm text-muted-foreground">
              Not connected. Authenticate with your Claude account to enable this provider.
            </div>
            <div v-if="claudeCodeMessage" class="mt-2 text-xs" :class="claudeCodeError ? 'text-destructive' : 'text-green-600'">
              {{ claudeCodeMessage }}
            </div>
            <div class="mt-auto pt-4">
              <Button
                class="w-full"
                :disabled="connectingClaudeCode"
                @click="handleConnectClaudeCode"
              >
                {{ connectingClaudeCode ? "Connecting..." : "Authenticate with Claude" }}
              </Button>
            </div>
          </template>
        </CardContent>
      </Card>

      <Card
        v-for="provider in providerConfigs"
        :key="provider.type"
        class="flex flex-col"
      >
        <CardHeader>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-lg"
                :class="provider.iconBg"
              >
                <Icon :name="provider.icon" class="h-4 w-4" :class="provider.iconColor" />
              </div>
              <CardTitle>{{ provider.label }}</CardTitle>
            </div>
            <div class="flex items-center gap-2">
              <Badge v-if="getExisting(provider.type)" variant="secondary">Connected</Badge>
              <Button
                variant="ghost"
                size="icon-sm"
                as="a"
                :href="provider.keyUrl"
                target="_blank"
              >
                <ExternalLink class="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <CardDescription>{{ provider.description }}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-1 flex-col">
          <div class="space-y-2">
            <Label>API Key</Label>
            <Input
              v-model="provider.keyInput"
              type="password"
              :placeholder="
                getExisting(provider.type)
                  ? 'Enter new key to update'
                  : 'Enter your API key'
              "
            />
          </div>
          <div v-if="testResults[provider.type]" class="mt-2 text-xs" :class="testResults[provider.type].success ? 'text-green-600' : 'text-destructive'">
            {{ testResults[provider.type].message }}
          </div>
          <div class="mt-auto flex gap-2 pt-4">
            <Button
              v-if="getExisting(provider.type)"
              variant="outline"
              class="flex-1"
              :disabled="testing[provider.type]"
              @click="handleTest(provider.type)"
            >
              {{ testing[provider.type] ? "Testing..." : "Test Connection" }}
            </Button>
            <Button
              :disabled="!provider.keyInput || saving[provider.type]"
              class="flex-1"
              @click="handleSave(provider.type)"
            >
              {{
                saving[provider.type]
                  ? "Saving..."
                  : getExisting(provider.type)
                    ? "Update Key"
                    : "Add Provider"
              }}
            </Button>
            <Button
              v-if="getExisting(provider.type)"
              variant="destructive"
              size="icon"
              @click="handleRemove(provider.type)"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Trash2, ExternalLink } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { useProviders } from "~/composables/useProviders";
import { useDashboardAuth } from "~/composables/useDashboardAuth";
import { dashboardFetch } from "~/utils/dashboard-fetch";

definePageMeta({ layout: "dashboard" });

const { isAuthenticated, isLoading: authLoading } = useDashboardAuth();

const { providers, fetchProviders, createProvider, updateProvider, removeProvider } =
  useProviders();

const claudeCodeLoading = ref(true);
const claudeCodeAvailable = ref(false);
const connectingClaudeCode = ref(false);
const disconnecting = ref(false);
const claudeCodeMessage = ref("");
const claudeCodeError = ref(false);

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

async function handleConnectClaudeCode() {
  connectingClaudeCode.value = true;
  try {
    const data = await dashboardFetch<{ url: string }>("/api/dashboard/claude-code-auth/start");
    window.location.href = data.url;
  } catch {
    claudeCodeMessage.value = "Failed to start authentication. Please make sure you're logged in.";
    claudeCodeError.value = true;
    connectingClaudeCode.value = false;
  }
}

async function handleDisconnectClaudeCode() {
  disconnecting.value = true;
  try {
    await dashboardFetch("/api/dashboard/claude-code-auth/disconnect", { method: "POST" });
    claudeCodeAvailable.value = false;
    claudeCodeMessage.value = "Disconnected successfully.";
    claudeCodeError.value = false;
  } catch {
    claudeCodeMessage.value = "Failed to disconnect.";
    claudeCodeError.value = true;
  } finally {
    disconnecting.value = false;
  }
}

function handleOAuthResult() {
  const route = useRoute();
  const authResult = route.query.claude_code_auth as string | undefined;
  if (authResult === "success") {
    claudeCodeAvailable.value = true;
    claudeCodeLoading.value = false;
    claudeCodeMessage.value = "Successfully authenticated with Claude.";
    claudeCodeError.value = false;
  } else if (authResult === "error") {
    claudeCodeMessage.value = (route.query.message as string) || "Authentication failed.";
    claudeCodeError.value = true;
  }
}

const saving = reactive<Record<string, boolean>>({
  gemini: false,
  openrouter: false,
});

const testing = reactive<Record<string, boolean>>({
  "claude-code": false,
  gemini: false,
  openrouter: false,
});

const testResults = reactive<Record<string, { success: boolean; message: string }>>({});

async function handleTest(type: string) {
  testing[type] = true;
  delete testResults[type];
  try {
    const data = await dashboardFetch<{ success: boolean; modelCount?: number; error?: string }>(
      "/api/dashboard/providers/test",
      { method: "POST", body: { type } },
    );
    if (data.success) {
      testResults[type] = { success: true, message: `Connected (${data.modelCount} models available)` };
    } else {
      testResults[type] = { success: false, message: data.error || "Test failed" };
    }
  } catch (err: unknown) {
    const fetchErr = err as { data?: { error?: string }; statusCode?: number };
    const msg = fetchErr?.data?.error
      || (fetchErr?.statusCode ? `Server error (${fetchErr.statusCode})` : "Failed to reach test endpoint");
    testResults[type] = { success: false, message: msg };
  } finally {
    testing[type] = false;
  }
}

const providerConfigs = reactive([
  {
    type: "gemini" as const,
    label: "Google Gemini",
    description: "Gemini models via the Google Generative AI API.",
    keyInput: "",
    keyUrl: "https://aistudio.google.com/app/apikey",
    icon: "lucide:sparkle",
    iconBg: "bg-blue-100 dark:bg-blue-900/30",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  {
    type: "openrouter" as const,
    label: "OpenRouter",
    description: "Access hundreds of models through OpenRouter's unified API.",
    keyInput: "",
    keyUrl: "https://openrouter.ai/keys",
    icon: "lucide:globe",
    iconBg: "bg-green-100 dark:bg-green-900/30",
    iconColor: "text-green-600 dark:text-green-400",
  },
]);

const getExisting = (type: string) =>
  providers.value.find((p) => p.type === type);

const handleSave = async (type: "gemini" | "openrouter") => {
  const config = providerConfigs.find((p) => p.type === type);
  if (!config?.keyInput) return;

  saving[type] = true;
  try {
    const existing = getExisting(type);
    if (existing) {
      await updateProvider(String(existing._id), {
        apiKey: config.keyInput,
      });
    } else {
      await createProvider(type, config.keyInput);
    }
    config.keyInput = "";
    toast.success(existing ? "Provider updated" : "Provider added");
  } catch (err) {
    console.error(`Failed to save ${type} provider:`, err);
    toast.error("Failed to save provider");
  } finally {
    saving[type] = false;
  }
};

const handleRemove = async (type: string) => {
  const existing = getExisting(type);
  if (!existing) return;
  try {
    await removeProvider(String(existing._id));
    toast.success("Provider removed");
  } catch {
    toast.error("Failed to remove provider");
  }
};

// Handle OAuth result synchronously (only reads query params)
handleOAuthResult();

// Wait for auth session before fetching data — on a full page refresh the
// session token isn't available yet when onMounted fires, which would cause
// dashboardFetch to fail and briefly show the "Authenticate" button.
watch(
  [isAuthenticated, authLoading],
  ([authed, loading]) => {
    if (!loading && authed) {
      fetchProviders();
      checkClaudeCodeStatus();
    }
  },
  { immediate: true },
);
</script>
