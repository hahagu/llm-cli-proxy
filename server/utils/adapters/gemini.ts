import type {
  ProviderAdapter,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIModelEntry,
  OpenAIMessage,
  OpenAIContentPart,
  OpenAIToolCall,
  OpenAIStreamChunk,
} from "./types";
import { mapProviderHttpError, providerError } from "../errors";
import { generateId, nowUnix } from "./types";

export const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta";

// --- Request Translation ---

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
    responseMimeType?: string;
    frequencyPenalty?: number;
    presencePenalty?: number;
  };
  tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
  toolConfig?: {
    functionCallingConfig: {
      mode: "AUTO" | "ANY" | "NONE";
      allowedFunctionNames?: string[];
    };
  };
}

function translateContentPart(part: OpenAIContentPart): GeminiPart {
  if (part.type === "text") {
    return { text: part.text };
  }
  const url = part.image_url.url;
  if (url.startsWith("data:")) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { inlineData: { mimeType: match[1]!, data: match[2]! } };
    }
  }
  return { fileData: { mimeType: "image/jpeg", fileUri: url } };
}

function translateMessages(messages: OpenAIMessage[]): {
  systemInstruction: string | undefined;
  contents: GeminiContent[];
} {
  let systemInstruction: string | undefined;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : (msg.content ?? [])
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join("\n");
      systemInstruction = systemInstruction
        ? systemInstruction + "\n" + text
        : text;
      continue;
    }

    if (msg.role === "tool") {
      // Tool results in Gemini are functionResponse parts
      let responseData: Record<string, unknown>;
      try {
        responseData =
          typeof msg.content === "string"
            ? JSON.parse(msg.content)
            : { result: msg.content };
      } catch {
        responseData = { result: msg.content };
      }
      contents.push({
        role: "user",
        parts: [
          {
            functionResponse: {
              name: msg.name ?? "unknown",
              response: responseData,
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (msg.content) {
        if (typeof msg.content === "string") {
          parts.push({ text: msg.content });
        } else {
          for (const part of msg.content) {
            parts.push(translateContentPart(part));
          }
        }
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || "{}"),
            },
          });
        }
      }
      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    // user message
    if (typeof msg.content === "string") {
      contents.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (Array.isArray(msg.content)) {
      const parts = msg.content.map(translateContentPart);
      contents.push({ role: "user", parts });
    }
  }

  return { systemInstruction, contents };
}

export function buildGeminiRequest(req: OpenAIChatRequest): GeminiRequest {
  const { systemInstruction, contents } = translateMessages(req.messages);
  const geminiReq: GeminiRequest = { contents };

  if (systemInstruction) {
    geminiReq.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  const genConfig: GeminiRequest["generationConfig"] = {};
  if (req.temperature !== undefined) genConfig.temperature = req.temperature;
  if (req.top_p !== undefined) genConfig.topP = req.top_p;
  if (req.max_tokens !== undefined) genConfig.maxOutputTokens = req.max_tokens;
  if (req.stop) {
    genConfig.stopSequences = Array.isArray(req.stop) ? req.stop : [req.stop];
  }
  if (req.response_format?.type === "json_object") {
    genConfig.responseMimeType = "application/json";
  }
  if (req.frequency_penalty !== undefined)
    genConfig.frequencyPenalty = req.frequency_penalty;
  if (req.presence_penalty !== undefined)
    genConfig.presencePenalty = req.presence_penalty;
  if (Object.keys(genConfig).length > 0) {
    geminiReq.generationConfig = genConfig;
  }

  if (req.tools && req.tools.length > 0) {
    geminiReq.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      },
    ];
  }

  // Map tool_choice to Gemini's toolConfig
  if (req.tool_choice && req.tools && req.tools.length > 0) {
    if (req.tool_choice === "none") {
      geminiReq.toolConfig = { functionCallingConfig: { mode: "NONE" } };
    } else if (req.tool_choice === "auto") {
      geminiReq.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    } else if (req.tool_choice === "required") {
      geminiReq.toolConfig = { functionCallingConfig: { mode: "ANY" } };
    } else if (
      typeof req.tool_choice === "object" &&
      req.tool_choice.function?.name
    ) {
      geminiReq.toolConfig = {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [req.tool_choice.function.name],
        },
      };
    }
  }

  return geminiReq;
}

// --- Response Translation ---

export interface GeminiResponse {
  candidates: Array<{
    content: { role: string; parts: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  modelVersion?: string;
}

function translateFinishReason(
  reason: string | undefined,
): "stop" | "length" | "tool_calls" | null {
  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "TOOL_CALLS":
      return "tool_calls";
    default:
      return reason ? "stop" : null;
  }
}

export function translateGeminiResponse(
  resp: GeminiResponse,
  model: string,
): OpenAIChatResponse {
  const candidate = resp.candidates?.[0];
  let textContent = "";
  const toolCalls: OpenAIToolCall[] = [];

  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.text) {
        textContent += part.text;
      } else if (part.inlineData) {
        textContent += `![image](data:${part.inlineData.mimeType};base64,${part.inlineData.data})`;
      } else if (part.functionCall) {
        toolCalls.push({
          id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args),
          },
        });
      }
    }
  }

  const finishReason =
    toolCalls.length > 0
      ? ("tool_calls" as const)
      : translateFinishReason(candidate?.finishReason);

  return {
    id: generateId(),
    object: "chat.completion",
    created: nowUnix(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: textContent || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: resp.usageMetadata
      ? {
          prompt_tokens: resp.usageMetadata.promptTokenCount,
          completion_tokens: resp.usageMetadata.candidatesTokenCount,
          total_tokens: resp.usageMetadata.totalTokenCount,
        }
      : undefined,
  };
}

// --- Streaming ---

export function createStreamTransformer(
  requestId: string,
  model: string,
  includeUsage = false,
): TransformStream<string, string> {
  let sentRole = false;

  return new TransformStream({
    transform(line, controller) {
      if (!line.startsWith("data: ")) return;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") return;

      let event: GeminiResponse;
      try {
        event = JSON.parse(jsonStr);
      } catch {
        return;
      }

      const candidate = event.candidates?.[0];
      if (!candidate?.content?.parts) return;

      for (const part of candidate.content.parts) {
        if (part.text !== undefined) {
          const chunk: OpenAIStreamChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: nowUnix(),
            model,
            choices: [
              {
                index: 0,
                delta: {
                  ...(sentRole ? {} : { role: "assistant" }),
                  content: part.text,
                },
                finish_reason: null,
              },
            ],
          };
          sentRole = true;
          controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        } else if (part.inlineData) {
          const markdownImage = `![image](data:${part.inlineData.mimeType};base64,${part.inlineData.data})`;
          const chunk: OpenAIStreamChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: nowUnix(),
            model,
            choices: [
              {
                index: 0,
                delta: {
                  ...(sentRole ? {} : { role: "assistant" }),
                  content: markdownImage,
                },
                finish_reason: null,
              },
            ],
          };
          sentRole = true;
          controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        } else if (part.functionCall) {
          const chunk: OpenAIStreamChunk = {
            id: requestId,
            object: "chat.completion.chunk",
            created: nowUnix(),
            model,
            choices: [
              {
                index: 0,
                delta: {
                  ...(sentRole ? {} : { role: "assistant" }),
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
                      type: "function",
                      function: {
                        name: part.functionCall.name,
                        arguments: JSON.stringify(part.functionCall.args),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          sentRole = true;
          controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      }

      if (candidate.finishReason) {
        const finishReason = translateFinishReason(candidate.finishReason);
        const chunk: OpenAIStreamChunk = {
          id: requestId,
          object: "chat.completion.chunk",
          created: nowUnix(),
          model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason,
            },
          ],
          usage:
            includeUsage && event.usageMetadata
              ? {
                  prompt_tokens: event.usageMetadata.promptTokenCount,
                  completion_tokens: event.usageMetadata.candidatesTokenCount,
                  total_tokens: event.usageMetadata.totalTokenCount,
                }
              : undefined,
        };
        controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
        controller.enqueue("data: [DONE]\n\n");
      }
    },
  });
}

export function createLineDecoder(): TransformStream<Uint8Array, string> {
  return new TransformStream<Uint8Array, string>({
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
        if (trimmed) controller.enqueue(trimmed);
      }
    },
    flush(controller) {
      // @ts-expect-error accessing buffer property
      const remaining = this.buffer.trim();
      if (remaining) controller.enqueue(remaining);
    },
  });
}

// --- Adapter ---

export class GeminiAdapter implements ProviderAdapter {
  readonly name = "gemini";

  async complete(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<OpenAIChatResponse> {
    const geminiReq = buildGeminiRequest(request);
    const url = `${GEMINI_API_BASE}/models/${request.model}:generateContent?key=${providerApiKey}`;

    // Diagnostic: check what IP we're connecting from
    try {
      const ipResp = await fetch("https://api64.ipify.org");
      const ip = await ipResp.text();
      console.log(`[gemini] Outgoing IP from Nitro fetch: ${ip}`);
    } catch (e) {
      console.error("[gemini] IP check failed:", e);
    }

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiReq),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw mapProviderHttpError("Gemini", resp.status, errorBody);
    }

    const data = (await resp.json()) as GeminiResponse;
    return translateGeminiResponse(data, request.model);
  }

  async stream(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<ReadableStream<string>> {
    const geminiReq = buildGeminiRequest(request);
    const url = `${GEMINI_API_BASE}/models/${request.model}:streamGenerateContent?alt=sse&key=${providerApiKey}`;
    const requestId = generateId();

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiReq),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw mapProviderHttpError("Gemini", resp.status, errorBody);
    }

    if (!resp.body) {
      throw providerError("No response body from Gemini API");
    }

    return resp.body
      .pipeThrough(createLineDecoder())
      .pipeThrough(
        createStreamTransformer(
          requestId,
          request.model,
          !!request.stream_options?.include_usage,
        ),
      );
  }

  async listModels(providerApiKey: string): Promise<OpenAIModelEntry[]> {
    // Diagnostic: check what IP we're connecting from
    try {
      const ipResp = await fetch("https://api64.ipify.org");
      const ip = await ipResp.text();
      console.log(`[gemini:listModels] Outgoing IP from Nitro fetch: ${ip}`);
    } catch (e) {
      console.error("[gemini:listModels] IP check failed:", e);
    }

    const url = `${GEMINI_API_BASE}/models?key=${providerApiKey}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const body = await resp.text();
      throw mapProviderHttpError("Gemini", resp.status, body);
    }
    const data = (await resp.json()) as {
      models: Array<{ name: string; displayName: string }>;
    };
    return data.models
      .filter((m) => m.name.includes("gemini"))
      .map((m) => ({
        id: m.name.replace("models/", ""),
        object: "model" as const,
        created: nowUnix(),
        owned_by: "google",
        ...(m.displayName ? { name: m.displayName } : {}),
      }));
  }
}
