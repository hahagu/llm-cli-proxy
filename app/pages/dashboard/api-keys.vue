<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">API Keys</h1>
        <p class="text-sm text-muted-foreground">
          Manage API keys for accessing your proxy endpoints.
        </p>
      </div>
      <Dialog v-model:open="showCreateDialog">
        <DialogTrigger as-child>
          <Button>
            <Plus class="mr-2 h-4 w-4" />
            Generate Key
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for proxy access. The key will only be shown
              once.
            </DialogDescription>
          </DialogHeader>
          <div class="space-y-4 py-4">
            <div class="space-y-2">
              <Label for="keyName">Key Name</Label>
              <Input
                id="keyName"
                v-model="newKeyName"
                placeholder="e.g., CLI Tool, Production App"
              />
            </div>
            <div class="space-y-2">
              <Label for="rateLimit">Rate Limit (requests/min, optional)</Label>
              <Input
                id="rateLimit"
                v-model.number="newKeyRateLimit"
                type="number"
                placeholder="Leave empty for unlimited"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" @click="showCreateDialog = false">
              Cancel
            </Button>
            <Button :disabled="!newKeyName || isGenerating" @click="handleGenerate">
              {{ isGenerating ? "Generating..." : "Generate" }}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    <!-- Newly generated key display -->
    <Card v-if="generatedKey" class="border-primary">
      <CardHeader>
        <CardTitle class="text-primary">New API Key Created</CardTitle>
        <CardDescription>
          Copy this key now. It will not be shown again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          class="flex items-center gap-2 rounded-lg bg-muted p-3 font-mono text-sm"
        >
          <code class="flex-1 break-all">{{ generatedKey }}</code>
          <Button variant="ghost" size="icon" @click="copyKey">
            <Copy class="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>

    <!-- API Keys Table -->
    <Card>
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rate Limit</TableHead>
              <TableHead>Last Used</TableHead>
              <TableHead>Created</TableHead>
              <TableHead class="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading">
              <TableCell :colspan="7" class="text-center text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
            <TableRow v-else-if="keys.length === 0">
              <TableCell :colspan="7" class="text-center text-muted-foreground">
                No API keys yet. Generate one to get started.
              </TableCell>
            </TableRow>
            <TableRow v-for="key in keys" :key="String(key._id)">
              <TableCell class="font-medium">{{ key.name }}</TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground">
                {{ key.keyPrefix }}...
              </TableCell>
              <TableCell>
                <Badge :variant="key.isActive ? 'default' : 'secondary'">
                  {{ key.isActive ? "Active" : "Inactive" }}
                </Badge>
              </TableCell>
              <TableCell>
                {{
                  key.rateLimitPerMinute
                    ? `${key.rateLimitPerMinute}/min`
                    : "Unlimited"
                }}
              </TableCell>
              <TableCell class="text-xs text-muted-foreground">
                {{ key.lastUsedAt ? formatDate(key.lastUsedAt as number) : "Never" }}
              </TableCell>
              <TableCell class="text-xs text-muted-foreground">
                {{ formatDate(key.createdAt as number) }}
              </TableCell>
              <TableCell class="text-right">
                <DropdownMenu>
                  <DropdownMenuTrigger as-child>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal class="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      v-if="key.isActive"
                      @click="deactivateKey(String(key._id))"
                    >
                      Deactivate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      v-else
                      @click="activateKey(String(key._id))"
                    >
                      Activate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      class="text-destructive"
                      @click="removeKey(String(key._id))"
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { Plus, Copy, MoreHorizontal } from "lucide-vue-next";
import { useApiKeys } from "~/composables/useApiKeys";

definePageMeta({ layout: "dashboard" });

const { keys, loading, fetchKeys, generateKey, deactivateKey, activateKey, removeKey } =
  useApiKeys();

const showCreateDialog = ref(false);
const newKeyName = ref("");
const newKeyRateLimit = ref<number | undefined>();
const isGenerating = ref(false);
const generatedKey = ref<string | null>(null);

const formatDate = (timestamp: number) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(timestamp));
  } catch {
    return "—";
  }
};

const handleGenerate = async () => {
  if (!newKeyName.value) return;
  isGenerating.value = true;
  try {
    const result = await generateKey(newKeyName.value, newKeyRateLimit.value);
    generatedKey.value = result.key;
    showCreateDialog.value = false;
    newKeyName.value = "";
    newKeyRateLimit.value = undefined;
  } catch (err) {
    console.error("Failed to generate key:", err);
  } finally {
    isGenerating.value = false;
  }
};

const copyKey = async () => {
  if (generatedKey.value) {
    await navigator.clipboard.writeText(generatedKey.value);
  }
};

onMounted(fetchKeys);
</script>
