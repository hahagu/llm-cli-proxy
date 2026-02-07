import type {
  ProviderAdapter,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIModelEntry,
} from "./types";
import { nowUnix } from "./types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

export class OpenRouterAdapter implements ProviderAdapter {
  readonly name = "openrouter";

  async complete(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<OpenAIChatResponse> {
    const resp = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${providerApiKey}`,
        "HTTP-Referer": process.env.VITE_CONVEX_SITE_URL ?? "https://llm-proxy.local",
        "X-Title": "LLM CLI Proxy",
      },
      body: JSON.stringify({ ...request, stream: false }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`OpenRouter API error ${resp.status}: ${errorBody}`);
    }

    return (await resp.json()) as OpenAIChatResponse;
  }

  async stream(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<ReadableStream<string>> {
    const resp = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${providerApiKey}`,
        "HTTP-Referer": process.env.VITE_CONVEX_SITE_URL ?? "https://llm-proxy.local",
        "X-Title": "LLM CLI Proxy",
      },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`OpenRouter API error ${resp.status}: ${errorBody}`);
    }

    if (!resp.body) {
      throw new Error("No response body from OpenRouter API");
    }

    // OpenRouter already returns OpenAI-format SSE, pipe through directly
    const lineDecoder = new TransformStream<Uint8Array, string>({
      start() {
        // @ts-expect-error adding buffer property
        this.buffer = "";
      },
      transform(chunk, controller) {
        // @ts-expect-error accessing buffer property
        this.buffer += new TextDecoder().decode(chunk);
        // @ts-expect-error accessing buffer property
        const lines = this.buffer.split("\n");
        // @ts-expect-error accessing buffer property
        this.buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            // Pass SSE lines through as-is (they're already in OpenAI format)
            controller.enqueue(trimmed + "\n\n");
          }
        }
      },
      flush(controller) {
        // @ts-expect-error accessing buffer property
        const remaining = this.buffer.trim();
        if (remaining) {
          controller.enqueue(remaining + "\n\n");
        }
      },
    });

    return resp.body.pipeThrough(lineDecoder);
  }

  async listModels(providerApiKey: string): Promise<OpenAIModelEntry[]> {
    const resp = await fetch(`${OPENROUTER_API_URL}/models`, {
      headers: {
        "Authorization": `Bearer ${providerApiKey}`,
      },
    });

    if (!resp.ok) {
      throw new Error(`OpenRouter models list error ${resp.status}`);
    }

    const data = (await resp.json()) as {
      data: Array<{ id: string; name: string; created: number }>;
    };

    return data.data.map((m) => ({
      id: m.id,
      object: "model" as const,
      created: m.created ?? nowUnix(),
      owned_by: "openrouter",
    }));
  }
}
