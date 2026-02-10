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
        </CardContent>
      </Card>
      <Card>
        <CardHeader class="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle class="text-sm font-medium">Success Rate</CardTitle>
          <CheckCircle2 class="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ successRate }}%</div>
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
    </div>

    <!-- Logs table -->
    <Card class="py-0">
      <CardContent class="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead class="text-right">Input Tokens</TableHead>
              <TableHead class="text-right">Output Tokens</TableHead>
              <TableHead class="text-right">Latency</TableHead>
              <TableHead>Error</TableHead>
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
            <TableRow v-for="log in filteredLogs" :key="String(log._id)">
              <TableCell class="whitespace-nowrap text-xs text-muted-foreground">
                {{ formatDateTime(log.createdAt) }}
              </TableCell>
              <TableCell>
                <Badge :variant="log.statusCode < 400 ? 'default' : 'destructive'">
                  {{ log.statusCode }}
                </Badge>
              </TableCell>
              <TableCell class="max-w-[200px] truncate font-mono text-xs">
                {{ log.model }}
              </TableCell>
              <TableCell class="text-sm">
                {{ log.apiKeyName ?? 'Unknown' }}
              </TableCell>
              <TableCell class="text-right font-mono text-xs">
                {{ log.inputTokens?.toLocaleString() ?? '—' }}
              </TableCell>
              <TableCell class="text-right font-mono text-xs">
                {{ log.outputTokens?.toLocaleString() ?? '—' }}
              </TableCell>
              <TableCell class="text-right font-mono text-xs">
                {{ log.latencyMs.toLocaleString() }}ms
              </TableCell>
              <TableCell class="max-w-[250px]">
                <Tooltip v-if="log.errorMessage">
                  <TooltipTrigger as-child>
                    <span class="block truncate text-xs text-destructive">
                      {{ log.errorMessage }}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" class="max-w-sm">
                    <p class="text-xs">{{ log.errorMessage }}</p>
                  </TooltipContent>
                </Tooltip>
                <span v-else class="text-xs text-muted-foreground">—</span>
              </TableCell>
            </TableRow>
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
} from "lucide-vue-next";
import { useUsageLogs, type UsageLog } from "~/composables/useUsageLogs";

definePageMeta({ layout: "dashboard" });

const { logs, loading, fetchLogs } = useUsageLogs();

const statusFilter = ref("all");
const modelFilter = ref("all");
const keyFilter = ref("all");

const uniqueModels = computed(() =>
  [...new Set(logs.value.map((l) => l.model))].sort(),
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
    return true;
  });
});

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

const avgLatency = computed(() => {
  if (logs.value.length === 0) return 0;
  const total = logs.value.reduce((sum, l) => sum + l.latencyMs, 0);
  return Math.round(total / logs.value.length);
});

const formatDateTime = (timestamp: number) => {
  try {
    return new Intl.DateTimeFormat(undefined, {
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

const refresh = () => fetchLogs(100);

onMounted(() => fetchLogs(100));
</script>
