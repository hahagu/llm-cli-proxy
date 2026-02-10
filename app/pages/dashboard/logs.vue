<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Usage Logs</h1>
        <p class="text-sm text-muted-foreground">
          View API request history, token usage, and errors.
        </p>
      </div>
      <Button variant="outline" size="sm" :disabled="loading" @click="refresh">
        <RefreshCw class="h-4 w-4" :class="{ 'animate-spin': loading }" />
        Refresh
      </Button>
    </div>

    <!-- Summary cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">Total Requests</CardTitle>
          <Activity class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ logs.length }}</div>
          <p class="text-xs text-muted-foreground">
            {{ errorCount }} failed
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">Success Rate</CardTitle>
          <CheckCircle2 class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ successRate }}%</div>
          <p class="text-xs text-muted-foreground">
            {{ streamedCount }} streamed / {{ nonStreamedCount }} non-streamed
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">Total Tokens</CardTitle>
          <Zap class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ totalTokens.toLocaleString() }}</div>
          <p class="text-xs text-muted-foreground">
            {{ totalInputTokens.toLocaleString() }} in / {{ totalOutputTokens.toLocaleString() }} out
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">Avg Latency</CardTitle>
          <Clock class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ avgLatency }}ms</div>
          <p class="text-xs text-muted-foreground">
            p50 {{ p50Latency }}ms / p95 {{ p95Latency }}ms
          </p>
        </CardContent>
      </Card>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2">
        <Label class="text-sm">Status</Label>
        <Select v-model="statusFilter">
          <SelectTrigger class="w-[130px]">
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center gap-2">
        <Label class="text-sm">Model</Label>
        <Select v-model="modelFilter">
          <SelectTrigger class="w-[180px]">
            <SelectValue placeholder="All models" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All models</SelectItem>
            <SelectItem v-for="m in uniqueModels" :key="m" :value="m">
              {{ m }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center gap-2">
        <Label class="text-sm">API Key</Label>
        <Select v-model="keyFilter">
          <SelectTrigger class="w-[180px]">
            <SelectValue placeholder="All keys" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All keys</SelectItem>
            <SelectItem v-for="k in uniqueKeys" :key="k.id" :value="k.id">
              {{ k.name }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center gap-2">
        <Label class="text-sm">Endpoint</Label>
        <Select v-model="endpointFilter">
          <SelectTrigger class="w-[200px]">
            <SelectValue placeholder="All endpoints" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All endpoints</SelectItem>
            <SelectItem v-for="ep in uniqueEndpoints" :key="ep" :value="ep">
              {{ ep }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>

    <!-- Logs table -->
    <Card class="py-0">
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead class="w-[30px]" />
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead class="text-right">Tokens</TableHead>
              <TableHead class="text-right">Latency</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-if="loading">
              <TableCell :colspan="8" class="text-center text-muted-foreground">
                Loading...
              </TableCell>
            </TableRow>
            <TableRow v-else-if="filteredLogs.length === 0">
              <TableCell :colspan="8" class="text-center text-muted-foreground">
                {{ logs.length === 0 ? 'No usage logs yet. Logs appear when API requests are made through the proxy.' : 'No logs match the current filters.' }}
              </TableCell>
            </TableRow>
            <template v-for="log in filteredLogs" :key="String(log._id)">
              <TableRow
                class="cursor-pointer"
                :class="{ 'border-b-0': expandedId === log._id }"
                @click="toggleExpand(log._id)"
              >
                <TableCell class="w-[30px] px-2">
                  <ChevronRight
                    class="h-4 w-4 text-muted-foreground transition-transform"
                    :class="{ 'rotate-90': expandedId === log._id }"
                  />
                </TableCell>
                <TableCell class="whitespace-nowrap text-xs">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <span class="text-muted-foreground">{{ relativeTime(log.createdAt) }}</span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p class="text-xs">{{ formatDateTimeFull(log.createdAt) }}</p>
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  <Badge :variant="log.statusCode < 400 ? 'default' : 'destructive'">
                    {{ log.statusCode }}
                  </Badge>
                </TableCell>
                <TableCell class="font-mono text-xs text-muted-foreground">
                  {{ log.endpoint ?? '—' }}
                </TableCell>
                <TableCell class="max-w-[200px] truncate font-mono text-xs">
                  {{ log.model }}
                </TableCell>
                <TableCell class="text-sm">
                  {{ log.apiKeyName ?? 'Unknown' }}
                </TableCell>
                <TableCell class="text-right font-mono text-xs">
                  <span v-if="log.inputTokens != null || log.outputTokens != null">
                    {{ (log.inputTokens ?? 0).toLocaleString() }} / {{ (log.outputTokens ?? 0).toLocaleString() }}
                  </span>
                  <span v-else class="text-muted-foreground">—</span>
                </TableCell>
                <TableCell class="text-right font-mono text-xs">
                  <span :class="latencyColor(log.latencyMs)">
                    {{ log.latencyMs.toLocaleString() }}ms
                  </span>
                </TableCell>
              </TableRow>
              <!-- Expanded detail panel -->
              <TableRow v-if="expandedId === log._id" class="bg-muted/30 hover:bg-muted/30">
                <TableCell :colspan="8" class="px-6 py-4">
                  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <!-- Request details -->
                    <div class="space-y-3">
                      <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Request Details
                      </h4>
                      <dl class="space-y-1.5 text-sm">
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Endpoint</dt>
                          <dd class="font-mono text-xs">{{ log.endpoint ?? '—' }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Provider</dt>
                          <dd>{{ log.providerType }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Streaming</dt>
                          <dd>
                            <Badge v-if="log.streamed != null" variant="outline" class="text-xs">
                              {{ log.streamed ? 'Yes' : 'No' }}
                            </Badge>
                            <span v-else class="text-muted-foreground">—</span>
                          </dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Messages</dt>
                          <dd>{{ log.messageCount ?? '—' }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Tools</dt>
                          <dd>
                            <Badge v-if="log.hasTools" variant="outline" class="text-xs">Yes</Badge>
                            <span v-else class="text-muted-foreground">No</span>
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <!-- Model parameters -->
                    <div class="space-y-3">
                      <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Model Parameters
                      </h4>
                      <dl class="space-y-1.5 text-sm">
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Model</dt>
                          <dd class="font-mono text-xs">{{ log.model }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Temperature</dt>
                          <dd>{{ log.temperature ?? 'default' }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Max Tokens</dt>
                          <dd>{{ log.maxTokens?.toLocaleString() ?? 'default' }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Stop Reason</dt>
                          <dd>
                            <Badge v-if="log.stopReason" variant="outline" class="text-xs">
                              {{ log.stopReason }}
                            </Badge>
                            <span v-else class="text-muted-foreground">—</span>
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <!-- Response details -->
                    <div class="space-y-3">
                      <h4 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Response Details
                      </h4>
                      <dl class="space-y-1.5 text-sm">
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Status Code</dt>
                          <dd>
                            <Badge :variant="log.statusCode < 400 ? 'default' : 'destructive'">
                              {{ log.statusCode }}
                            </Badge>
                          </dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Latency</dt>
                          <dd class="font-mono text-xs">{{ log.latencyMs.toLocaleString() }}ms</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Input Tokens</dt>
                          <dd class="font-mono text-xs">{{ log.inputTokens?.toLocaleString() ?? '—' }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Output Tokens</dt>
                          <dd class="font-mono text-xs">{{ log.outputTokens?.toLocaleString() ?? '—' }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">API Key</dt>
                          <dd>{{ log.apiKeyName ?? 'Unknown' }}</dd>
                        </div>
                        <div class="flex justify-between">
                          <dt class="text-muted-foreground">Timestamp</dt>
                          <dd class="text-xs">{{ formatDateTimeFull(log.createdAt) }}</dd>
                        </div>
                      </dl>
                    </div>
                  </div>

                  <!-- Error message (full display) -->
                  <div v-if="log.errorMessage" class="mt-4 space-y-1.5">
                    <h4 class="text-xs font-semibold uppercase tracking-wider text-destructive">
                      Error
                    </h4>
                    <pre class="whitespace-pre-wrap rounded-md bg-destructive/10 p-3 font-mono text-xs text-destructive">{{ log.errorMessage }}</pre>
                  </div>
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import {
  RefreshCw,
  Activity,
  CheckCircle2,
  Zap,
  Clock,
  ChevronRight,
} from "lucide-vue-next";
import { useUsageLogs } from "~/composables/useUsageLogs";

definePageMeta({ layout: "dashboard" });

const { logs, loading, fetchLogs } = useUsageLogs();

const statusFilter = ref("all");
const modelFilter = ref("all");
const keyFilter = ref("all");
const endpointFilter = ref("all");
const expandedId = ref<string | null>(null);

const toggleExpand = (id: string) => {
  expandedId.value = expandedId.value === id ? null : id;
};

const uniqueModels = computed(() =>
  [...new Set(logs.value.map((l) => l.model))].sort(),
);

const uniqueEndpoints = computed(() =>
  [...new Set(logs.value.map((l) => l.endpoint).filter(Boolean))].sort() as string[],
);

const uniqueKeys = computed(() => {
  const map = new Map<string, string>();
  for (const log of logs.value) {
    if (!map.has(log.apiKeyId)) {
      map.set(log.apiKeyId, log.apiKeyName ?? "Unknown");
    }
  }
  return [...map.entries()].map(([id, name]) => ({ id, name }));
});

const filteredLogs = computed(() => {
  return logs.value.filter((log) => {
    if (statusFilter.value === "success" && log.statusCode >= 400) return false;
    if (statusFilter.value === "error" && log.statusCode < 400) return false;
    if (modelFilter.value !== "all" && log.model !== modelFilter.value) return false;
    if (keyFilter.value !== "all" && log.apiKeyId !== keyFilter.value) return false;
    if (endpointFilter.value !== "all" && log.endpoint !== endpointFilter.value) return false;
    return true;
  });
});

const errorCount = computed(() =>
  logs.value.filter((l) => l.statusCode >= 400).length,
);

const streamedCount = computed(() =>
  logs.value.filter((l) => l.streamed === true).length,
);

const nonStreamedCount = computed(() =>
  logs.value.filter((l) => l.streamed === false).length,
);

const successRate = computed(() => {
  if (logs.value.length === 0) return 0;
  const successes = logs.value.filter((l) => l.statusCode < 400).length;
  return Math.round((successes / logs.value.length) * 100);
});

const totalInputTokens = computed(() =>
  logs.value.reduce((sum, l) => sum + (l.inputTokens ?? 0), 0),
);

const totalOutputTokens = computed(() =>
  logs.value.reduce((sum, l) => sum + (l.outputTokens ?? 0), 0),
);

const totalTokens = computed(() => totalInputTokens.value + totalOutputTokens.value);

const sortedLatencies = computed(() =>
  [...logs.value].map((l) => l.latencyMs).sort((a, b) => a - b),
);

const avgLatency = computed(() => {
  if (logs.value.length === 0) return 0;
  const total = logs.value.reduce((sum, l) => sum + l.latencyMs, 0);
  return Math.round(total / logs.value.length);
});

const p50Latency = computed(() => {
  const arr = sortedLatencies.value;
  if (arr.length === 0) return 0;
  return arr[Math.floor(arr.length * 0.5)];
});

const p95Latency = computed(() => {
  const arr = sortedLatencies.value;
  if (arr.length === 0) return 0;
  return arr[Math.floor(arr.length * 0.95)];
});

const latencyColor = (ms: number) => {
  if (ms < 1000) return "text-green-600 dark:text-green-400";
  if (ms < 5000) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
};

const relativeTime = (timestamp: number) => {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const formatDateTimeFull = (timestamp: number) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return "—";
  }
};

const refresh = () => fetchLogs(200);

onMounted(() => fetchLogs(200));
</script>
