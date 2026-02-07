<template>
  <div class="flex min-h-screen">
    <!-- Sidebar -->
    <aside class="hidden w-64 shrink-0 border-r border-border bg-card md:block">
      <div class="flex h-full flex-col">
        <div class="border-b border-border p-6">
          <h2 class="text-lg font-semibold tracking-tight">LLM Proxy</h2>
          <p class="text-xs text-muted-foreground">Management Dashboard</p>
        </div>

        <nav class="flex-1 space-y-1 p-4">
          <NuxtLink
            v-for="item in navItems"
            :key="item.to"
            :to="item.to"
            class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
            :class="
              isActive(item.to)
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            "
          >
            <component :is="item.icon" class="h-4 w-4" />
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="border-t border-border p-4">
          <div v-if="user" class="flex items-center gap-3">
            <div
              class="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold"
            >
              {{ userInitials }}
            </div>
            <div class="flex-1 truncate">
              <p class="truncate text-sm font-medium">{{ user?.name }}</p>
              <p class="truncate text-xs text-muted-foreground">
                {{ user?.email }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex gap-2">
            <Button
              variant="outline"
              size="sm"
              class="flex-1"
              @click="handleSignOut"
            >
              Sign out
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              @click="colorMode.toggle()"
            >
              <Sun v-if="colorMode.mode.value === 'dark'" />
              <Moon v-else />
            </Button>
          </div>
        </div>
      </div>
    </aside>

    <!-- Mobile header -->
    <div class="flex flex-1 flex-col">
      <header
        class="flex items-center gap-4 border-b border-border px-6 py-3 md:hidden"
      >
        <Sheet>
          <SheetTrigger as-child>
            <Button variant="ghost" size="icon">
              <Icon name="lucide:menu" class="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" class="w-64 p-0">
            <div class="border-b border-border p-6">
              <h2 class="text-lg font-semibold tracking-tight">LLM Proxy</h2>
            </div>
            <nav class="space-y-1 p-4">
              <NuxtLink
                v-for="item in navItems"
                :key="item.to"
                :to="item.to"
                class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                :class="
                  isActive(item.to)
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                "
              >
                <component :is="item.icon" class="h-4 w-4" />
                {{ item.label }}
              </NuxtLink>
            </nav>
          </SheetContent>
        </Sheet>
        <h1 class="flex-1 text-lg font-semibold">LLM Proxy</h1>
        <Button
          variant="outline"
          size="icon"
          @click="colorMode.toggle()"
        >
          <Sun v-if="colorMode.mode.value === 'dark'" />
          <Moon v-else />
        </Button>
      </header>

      <!-- Main content -->
      <main class="flex-1 p-6">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { authClient } from "~/lib/auth-client";
import { useDashboardAuth } from "~/composables/useDashboardAuth";
import { useColorMode } from "~/composables/useColorMode";
import {
  Settings,
  KeyRound,
  MessageSquare,
  LayoutDashboard,
  MessageCircle,
  Sun,
  Moon,
} from "lucide-vue-next";

const route = useRoute();
const { user } = useDashboardAuth();
const colorMode = useColorMode();

const navItems = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/dashboard/providers", label: "Providers", icon: Settings },
  { to: "/dashboard/api-keys", label: "API Keys", icon: KeyRound },
  {
    to: "/dashboard/system-prompts",
    label: "System Prompts",
    icon: MessageSquare,
  },
  { to: "/dashboard/chat", label: "Test Chat", icon: MessageCircle },
];

const isActive = (path: string) => {
  if (path === "/dashboard") return route.path === "/dashboard";
  return route.path.startsWith(path);
};

const userInitials = computed(() => {
  const name = user.value?.name;
  if (!name) return "U";
  return String(name)
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
});

const handleSignOut = async () => {
  try {
    await authClient.signOut();
  } catch (err) {
    console.error("Sign out failed:", err);
  }
};
</script>
