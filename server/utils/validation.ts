import { z } from "zod";

// --- OpenAI Chat Completion Request Schema ---

const contentPartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(["low", "high", "auto"]).optional(),
    }),
  }),
]);

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    arguments: z.string(),
  }),
});

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z
    .union([z.string(), z.array(contentPartSchema), z.null()])
    .optional(),
  name: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
  tool_call_id: z.string().optional(),
});

const toolSchema = z.object({
  type: z.literal("function"),
  function: z.object({
    name: z.string(),
    description: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  }),
});

export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  tools: z.array(toolSchema).optional(),
  tool_choice: z
    .union([
      z.enum(["none", "auto", "required"]),
      z.object({
        type: z.literal("function"),
        function: z.object({ name: z.string() }),
      }),
    ])
    .optional(),
  response_format: z
    .object({
      type: z.enum(["text", "json_object"]),
    })
    .optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  n: z.number().int().positive().optional(),
  user: z.string().optional(),
  stream_options: z
    .object({
      include_usage: z.boolean().optional(),
    })
    .optional(),
  thinking: z
    .object({
      type: z.string().optional(),
      budget_tokens: z.number().int().positive().optional(),
    })
    .passthrough()
    .optional(),
  reasoning_effort: z
    .enum(["none", "minimal", "low", "medium", "high", "xhigh"])
    .optional(),
});

// --- Anthropic Messages Request Schema ---

type AnthropicContentBlock = {
  type: string;
  text?: string;
  source?: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  [key: string]: unknown;
};

const anthropicContentBlockSchema: z.ZodType<AnthropicContentBlock> = z
  .object({
    type: z.string(),
    text: z.string().optional(),
    source: z
      .object({
        type: z.enum(["base64", "url"]),
        media_type: z.string().optional(),
        data: z.string().optional(),
        url: z.string().optional(),
      })
      .optional(),
    id: z.string().optional(),
    name: z.string().optional(),
    input: z.unknown().optional(),
    tool_use_id: z.string().optional(),
    content: z
      .union([z.string(), z.array(z.lazy(() => anthropicContentBlockSchema))])
      .optional(),
  })
  .passthrough();

const anthropicMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(anthropicContentBlockSchema)]),
});

const anthropicToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  input_schema: z.record(z.unknown()).optional(),
});

export const anthropicMessagesRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(anthropicMessageSchema).min(1),
    max_tokens: z.number().int().positive(),
    system: z
      .union([
        z.string(),
        z.array(
          z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
        ),
      ])
      .optional(),
    temperature: z.number().min(0).max(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().positive().optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional(),
    tools: z.array(anthropicToolSchema).optional(),
    tool_choice: z.unknown().optional(),
    metadata: z
      .object({
        user_id: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// --- Legacy Completions Request Schema ---

export const completionRequestSchema = z.object({
  model: z.string().min(1),
  prompt: z.union([z.string(), z.array(z.string())]),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().int().positive().optional(),
  stream: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  n: z.number().int().positive().optional(),
  user: z.string().optional(),
});

// --- Dashboard Schemas ---

export const generateKeySchema = z.object({
  name: z.string().min(1).max(100),
  rateLimitPerMinute: z.number().int().positive().optional(),
});
