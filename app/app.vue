<template>
  <div class="min-h-screen bg-background text-foreground">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <Toaster />
  </div>
</template>

<script setup lang="ts">
import { useColorMode } from "~/composables/useColorMode";

const colorMode = useColorMode();

onMounted(() => {
  colorMode.init();
});
</script>
