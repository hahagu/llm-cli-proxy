<template>
  <div class="flex h-[calc(100vh-(--spacing(12)))] flex-col">
    <!-- Header with config -->
    <div class="shrink-0 space-y-4 pb-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Test Chat</h1>
        <p class="text-sm text-muted-foreground">
          Send test messages through your proxy to verify your configuration.
        </p>
      </div>

      <div class="flex flex-wrap items-end gap-3">
        <div class="space-y-1.5">
          <Label class="text-xs">API Key</Label>
          <Select v-model="selectedApiKeyId">
            <SelectTrigger class="w-64">
              <SelectValue placeholder="Select an API key" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="key in activeKeys"
                :key="String(key._id)"
                :value="String(key._id)"
              >
                {{ key.name }}
                <span class="text-muted-foreground"> ({{ key.keyPrefix }}...)</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div class="space-y-1.5">
          <Label class="text-xs">Model</Label>
          <Select v-model="selectedModel">
            <SelectTrigger class="w-72">
              <SelectValue placeholder="Select a model" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="m in models"
                :key="m.id"
                :value="m.id"
              >
                {{ m.name || m.id }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="outline"
          :disabled="chat.messages.value.length === 0"
          @click="chat.clearMessages()"
        >
          <Trash2 />
          Clear
        </Button>
      </div>

      <div
        v-if="!selectedApiKeyId"
        class="rounded-lg border border-dashed border-border bg-muted/50 p-3 text-center text-sm text-muted-foreground"
      >
        Select an API key to start chatting. Generate keys from the
        <NuxtLink to="/dashboard/api-keys" class="font-medium text-primary underline">
          API Keys
        </NuxtLink>
        page.
      </div>
    </div>

    <!-- Messages area -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto rounded-lg border border-border">
      <div v-if="chat.messages.value.length === 0" class="flex h-full items-center justify-center">
        <div class="text-center text-sm text-muted-foreground">
          <MessageCircle class="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p>No messages yet. Send a message to get started.</p>
        </div>
      </div>

      <div v-else class="space-y-1 p-4">
        <div
          v-for="(msg, idx) in chat.messages.value"
          :key="idx"
          class="flex gap-3"
          :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm"
            :class="
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            "
          >
            <pre class="whitespace-pre-wrap font-sans">{{ msg.content }}</pre>
            <div
              v-if="msg.role === 'assistant' && !msg.content && chat.loading.value"
              class="flex items-center gap-1.5 py-1"
            >
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
              <span class="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Error display -->
    <div
      v-if="chat.error.value"
      class="mt-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {{ chat.error.value }}
    </div>

    <!-- Input area -->
    <div class="mt-3 flex shrink-0 gap-2">
      <Textarea
        v-model="inputMessage"
        placeholder="Type your message..."
        class="min-h-11 max-h-32 resize-none"
        rows="1"
        :disabled="!selectedApiKeyId || !selectedModel"
        @keydown.enter.exact.prevent="handleSend"
      />
      <Button
        v-if="chat.loading.value"
        variant="destructive"
        size="icon"
        class="shrink-0 self-end size-11"
        @click="chat.stopGeneration()"
      >
        <Square class="h-4 w-4" />
      </Button>
      <Button
        v-else
        size="icon"
        class="shrink-0 self-end size-11"
        :disabled="!inputMessage.trim() || !selectedApiKeyId || !selectedModel"
        @click="handleSend"
      >
        <Send class="h-4 w-4" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Send, Square, Trash2, MessageCircle } from "lucide-vue-next";
import { useTestChat } from "~/composables/useTestChat";
import { useModels } from "~/composables/useModels";
import { useApiKeys } from "~/composables/useApiKeys";

definePageMeta({ layout: "dashboard" });

const chat = useTestChat();
const { models, fetchModels } = useModels();
const { keys, fetchKeys } = useApiKeys();

const selectedApiKeyId = ref("");
const selectedModel = ref("");
const inputMessage = ref("");
const messagesContainer = ref<HTMLElement | null>(null);

const activeKeys = computed(() =>
  keys.value.filter((k) => k.isActive),
);

async function handleSend() {
  if (!inputMessage.value.trim() || !selectedApiKeyId.value || !selectedModel.value) return;

  const message = inputMessage.value;
  inputMessage.value = "";

  await chat.sendMessage(message, selectedApiKeyId.value, selectedModel.value);

  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
}

onMounted(() => {
  fetchModels();
  fetchKeys();
});
</script>
