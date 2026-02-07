// --- OpenAI Request Types ---

export interface OpenAIContentPartText {
  type: "text";
  text: string;
}

export interface OpenAIContentPartImage {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}

export type OpenAIContentPart = OpenAIContentPartText | OpenAIContentPartImage;

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  tools?: OpenAITool[];
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } };
  response_format?: { type: "text" | "json_object" };
  frequency_penalty?: number;
  presence_penalty?: number;
  n?: number;
  user?: string;
  stream_options?: { include_usage?: boolean };
}

// --- OpenAI Response Types ---

export interface OpenAIChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
}

export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChoice[];
  usage?: OpenAIUsage;
}

export interface OpenAIStreamChunkDelta {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
}

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAIStreamChunkDelta;
    finish_reason: string | null;
  }>;
  usage?: OpenAIUsage | null;
}

// --- Model Types ---

export interface OpenAIModelEntry {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  name?: string;
}

// --- Adapter Interface ---

export interface ProviderAdapter {
  readonly name: string;

  complete(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<OpenAIChatResponse>;

  stream(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<ReadableStream<string>>;

  listModels(providerApiKey: string): Promise<OpenAIModelEntry[]>;
}

// --- Utility ---

export function generateId(): string {
  return "chatcmpl-" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}
