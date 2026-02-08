import { getSessionToken } from "~/utils/dashboard-fetch";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function useTestChat() {
  const messages = ref<ChatMessage[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const abortController = ref<AbortController | null>(null);

  function addMessage(role: ChatMessage["role"], content: string) {
    messages.value.push({ role, content });
  }

  function clearMessages() {
    messages.value = [];
    error.value = null;
  }

  async function sendMessage(
    content: string,
    apiKeyId: string,
    model: string,
  ) {
    if (!content.trim() || !apiKeyId || !model) return;

    error.value = null;
    addMessage("user", content);
    addMessage("assistant", "");
    loading.value = true;

    const assistantIdx = messages.value.length - 1;

    abortController.value = new AbortController();

    try {
      const token = getSessionToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch("/api/dashboard/test-chat", {
        method: "POST",
        headers,
        body: JSON.stringify({
          apiKeyId,
          model,
          messages: messages.value
            .slice(0, -1) // exclude empty assistant message
            .map((m) => ({ role: m.role, content: m.content })),
          stream: true,
        }),
        signal: abortController.value.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        const msg =
          errData?.error || `Request failed (${response.status})`;
        messages.value.splice(assistantIdx, 1); // remove empty assistant msg
        error.value = msg;
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        error.value = "No response stream available";
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              messages.value[assistantIdx]!.content += delta;
            }
          } catch {
            // skip malformed JSON chunks
          }
        }
      }

      // Remove empty assistant message if nothing was received
      if (!messages.value[assistantIdx]?.content) {
        messages.value.splice(assistantIdx, 1);
        error.value = "No response received from model";
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled - keep partial response if any
        if (!messages.value[assistantIdx]?.content) {
          messages.value.splice(assistantIdx, 1);
        }
      } else {
        messages.value.splice(assistantIdx, 1);
        error.value =
          err instanceof Error ? err.message : "Failed to send message";
      }
    } finally {
      loading.value = false;
      abortController.value = null;
    }
  }

  function stopGeneration() {
    abortController.value?.abort();
  }

  return {
    messages,
    loading,
    error,
    sendMessage,
    stopGeneration,
    clearMessages,
  };
}
