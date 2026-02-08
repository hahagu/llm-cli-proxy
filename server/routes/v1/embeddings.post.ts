import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { parseModelWithProvider } from "~~/server/utils/adapters";
import { embeddingRequestSchema } from "~~/server/utils/validation";
import { OpenAIError, invalidRequest, providerError } from "~~/server/utils/errors";
import { GEMINI_API_BASE, geminiFetch } from "~~/server/utils/adapters/gemini";
import { api } from "~~/convex/_generated/api";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

export default defineEventHandler(async (event) => {
  const keyData = event.context.apiKeyData;
  if (!keyData) {
    setResponseStatus(event, 401);
    return {
      error: {
        message: "Unauthorized",
        type: "invalid_request_error",
        code: "unauthorized",
      },
    };
  }

  let rawBody: unknown;
  try {
    rawBody = await readBody(event);
  } catch {
    setResponseStatus(event, 400);
    return {
      error: {
        message: "Invalid request body",
        type: "invalid_request_error",
        code: "invalid_body",
      },
    };
  }

  const parsed = embeddingRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    setResponseStatus(event, 400);
    return {
      error: {
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        type: "invalid_request_error",
        code: "validation_error",
      },
    };
  }

  const body = parsed.data;

  try {
    const modelParsed = parseModelWithProvider(body.model);
    if (!modelParsed) {
      throw invalidRequest(`Cannot determine provider for model: ${body.model}`, "model");
    }

    const { provider, model: rawModel } = modelParsed;

    if (provider === "claude-code") {
      throw invalidRequest("Embeddings are not supported for Claude models. Use a Gemini or OpenRouter embedding model.", "model");
    }

    // Get credentials
    const convex = getConvexClient();
    const providerRecord = await convex.query(api.providers.queries.getByUserAndType, {
      userId: keyData.userId,
      type: provider as "gemini" | "openrouter",
    });
    if (!providerRecord) {
      throw providerError(`No credentials configured for provider ${provider}`);
    }
    const apiKey = decrypt(providerRecord.encryptedApiKey, providerRecord.keyIv);

    const inputs = Array.isArray(body.input) ? body.input : [body.input];

    if (provider === "gemini") {
      return await handleGeminiEmbedding(rawModel, inputs, apiKey);
    }

    if (provider === "openrouter") {
      return await handleOpenRouterEmbedding(rawModel, inputs, apiKey, body.encoding_format);
    }

    throw invalidRequest(`Embeddings not supported for provider: ${provider}`, "model");
  } catch (err) {
    if (err instanceof OpenAIError) {
      setResponseStatus(event, err.statusCode);
      return err.toResponse();
    }
    const message = err instanceof Error ? err.message : "Internal server error";
    setResponseStatus(event, 502);
    return {
      error: {
        message,
        type: "server_error",
        code: "provider_error",
        param: null,
      },
    };
  }
});

async function handleGeminiEmbedding(
  model: string,
  inputs: string[],
  apiKey: string,
) {
  // Gemini supports batch embedding via embedContent
  const embeddings: Array<{ object: string; index: number; embedding: number[] }> = [];
  let totalTokens = 0;

  for (let i = 0; i < inputs.length; i++) {
    const url = `${GEMINI_API_BASE}/models/${model}:embedContent?key=${apiKey}`;
    const resp = await geminiFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text: inputs[i] }] },
      }),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw providerError(`Gemini embedding error ${resp.status}: ${errorBody}`);
    }

    const data = (await resp.json()) as {
      embedding: { values: number[] };
    };

    embeddings.push({
      object: "embedding",
      index: i,
      embedding: data.embedding.values,
    });

    // Gemini doesn't return token counts for embeddings, estimate
    totalTokens += Math.ceil(inputs[i]!.length / 4);
  }

  return {
    object: "list",
    data: embeddings,
    model,
    usage: {
      prompt_tokens: totalTokens,
      total_tokens: totalTokens,
    },
  };
}

async function handleOpenRouterEmbedding(
  model: string,
  inputs: string[],
  apiKey: string,
  encodingFormat?: string,
) {
  const resp = await fetch(`${OPENROUTER_API_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: inputs,
      ...(encodingFormat ? { encoding_format: encodingFormat } : {}),
    }),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw providerError(`OpenRouter embedding error ${resp.status}: ${errorBody}`);
  }

  return await resp.json();
}
