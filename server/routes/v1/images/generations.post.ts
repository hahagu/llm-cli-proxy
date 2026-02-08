import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { parseModelWithProvider } from "~~/server/utils/adapters";
import { imageGenerationRequestSchema } from "~~/server/utils/validation";
import { OpenAIError, invalidRequest, mapProviderHttpError, providerError } from "~~/server/utils/errors";
import { GEMINI_API_BASE, geminiFetch } from "~~/server/utils/adapters/gemini";
import { nowUnix } from "~~/server/utils/adapters/types";
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

  const parsed = imageGenerationRequestSchema.safeParse(rawBody);
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
      throw invalidRequest(
        "Image generation is not supported for Claude models. Use a Gemini image model (e.g., gemini:gemini-2.0-flash-preview-image-generation).",
        "model",
      );
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

    if (provider === "gemini") {
      return await handleGeminiImageGeneration(rawModel, body, apiKey);
    }

    if (provider === "openrouter") {
      return await handleOpenRouterImageGeneration(rawModel, body, apiKey);
    }

    throw invalidRequest(`Image generation not supported for provider: ${provider}`, "model");
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

async function handleGeminiImageGeneration(
  model: string,
  body: { prompt: string; n: number; size?: string; quality?: string; style?: string },
  apiKey: string,
) {
  let enhancedPrompt = body.prompt;
  if (body.size) {
    enhancedPrompt += `\n\nGenerate the image at ${body.size} resolution.`;
  }
  if (body.quality === "hd") {
    enhancedPrompt += `\n\nGenerate a high-quality, detailed image.`;
  }
  if (body.style === "natural") {
    enhancedPrompt += `\n\nUse a natural, photorealistic style.`;
  } else if (body.style === "vivid") {
    enhancedPrompt += `\n\nUse a vivid, dramatic style with bold colors.`;
  }

  const requests = Array.from({ length: body.n }, () =>
    generateSingleImage(model, enhancedPrompt, apiKey),
  );
  const results = await Promise.all(requests);

  return {
    created: nowUnix(),
    data: results,
  };
}

interface GeminiImageResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }>;
    };
  }>;
}

async function generateSingleImage(
  model: string,
  prompt: string,
  apiKey: string,
): Promise<{ b64_json: string; revised_prompt?: string }> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const resp = await geminiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE", "TEXT"],
      },
    }),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw mapProviderHttpError("Gemini", resp.status, errorBody);
  }

  const data = (await resp.json()) as GeminiImageResponse;
  const parts = data.candidates?.[0]?.content?.parts;

  if (!parts) {
    throw providerError("Gemini returned no content for image generation");
  }

  let imageData: string | undefined;
  let revisedPrompt: string | undefined;

  for (const part of parts) {
    if (part.inlineData) {
      imageData = part.inlineData.data;
    }
    if (part.text) {
      revisedPrompt = part.text;
    }
  }

  if (!imageData) {
    throw providerError(
      "Gemini did not return image data. The model may not support image generation. " +
        "Try a model like gemini-2.0-flash-preview-image-generation.",
    );
  }

  return {
    b64_json: imageData,
    ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
  };
}

async function handleOpenRouterImageGeneration(
  model: string,
  body: { prompt: string; n: number; size?: string; quality?: string; style?: string; response_format: string },
  apiKey: string,
) {
  const resp = await fetch(`${OPENROUTER_API_URL}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: body.prompt,
      n: body.n,
      ...(body.size ? { size: body.size } : {}),
      ...(body.quality ? { quality: body.quality } : {}),
      ...(body.style ? { style: body.style } : {}),
      response_format: body.response_format,
    }),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw mapProviderHttpError("OpenRouter", resp.status, errorBody);
  }

  return await resp.json();
}
