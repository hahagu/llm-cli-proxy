import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { parseModelWithProvider } from "~~/server/utils/adapters";
import { OpenAIError, invalidRequest, mapProviderHttpError, providerError } from "~~/server/utils/errors";
import { GEMINI_API_BASE, geminiFetch } from "~~/server/utils/adapters/gemini";
import { nowUnix } from "~~/server/utils/adapters/types";
import { api } from "~~/convex/_generated/api";

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

  try {
    const formData = await readMultipartFormData(event);
    if (!formData) {
      throw invalidRequest("Request must be multipart/form-data");
    }

    // Extract fields from multipart form data
    const fields: Record<string, string> = {};
    let imageData: { buffer: Buffer; mimeType: string } | undefined;
    let maskData: { buffer: Buffer; mimeType: string } | undefined;

    for (const part of formData) {
      if (!part.name) continue;
      if (part.name === "image" && part.data) {
        imageData = { buffer: part.data, mimeType: part.type || "image/png" };
      } else if (part.name === "mask" && part.data) {
        maskData = { buffer: part.data, mimeType: part.type || "image/png" };
      } else if (part.data) {
        fields[part.name] = part.data.toString("utf-8");
      }
    }

    // Validate required fields
    if (!imageData) {
      throw invalidRequest("'image' is required", "image");
    }
    if (!fields.prompt) {
      throw invalidRequest("'prompt' is required", "prompt");
    }
    const model = fields.model;
    if (!model) {
      throw invalidRequest("'model' is required", "model");
    }

    const n = fields.n ? parseInt(fields.n, 10) : 1;
    if (isNaN(n) || n < 1 || n > 10) {
      throw invalidRequest("'n' must be an integer between 1 and 10", "n");
    }

    const modelParsed = parseModelWithProvider(model);
    if (!modelParsed) {
      throw invalidRequest(`Cannot determine provider for model: ${model}`, "model");
    }

    const { provider, model: rawModel } = modelParsed;

    if (provider === "claude-code") {
      throw invalidRequest(
        "Image editing is not supported for Claude models. Use a Gemini image model (e.g., gemini:gemini-2.0-flash-preview-image-generation).",
        "model",
      );
    }

    if (provider === "openrouter") {
      throw invalidRequest(
        "Image editing is not supported for OpenRouter models. Use a Gemini image model (e.g., gemini:gemini-2.0-flash-preview-image-generation).",
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
      return await handleGeminiImageEdit(rawModel, {
        prompt: fields.prompt,
        image: imageData,
        mask: maskData,
        n,
        size: fields.size,
      }, apiKey);
    }

    throw invalidRequest(`Image editing not supported for provider: ${provider}`, "model");
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

interface ImageEditParams {
  prompt: string;
  image: { buffer: Buffer; mimeType: string };
  mask?: { buffer: Buffer; mimeType: string };
  n: number;
  size?: string;
}

async function handleGeminiImageEdit(
  model: string,
  params: ImageEditParams,
  apiKey: string,
) {
  const requests = Array.from({ length: params.n }, () =>
    editSingleImage(model, params, apiKey),
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

async function editSingleImage(
  model: string,
  params: ImageEditParams,
  apiKey: string,
): Promise<{ b64_json: string; revised_prompt?: string }> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  let prompt = params.prompt;
  if (params.size) {
    prompt += `\n\nGenerate the image at ${params.size} resolution.`;
  }

  // Build parts: text prompt + source image (+ optional mask)
  const parts: Array<Record<string, unknown>> = [
    { text: prompt },
    {
      inlineData: {
        mimeType: params.image.mimeType,
        data: params.image.buffer.toString("base64"),
      },
    },
  ];

  if (params.mask) {
    parts.push({
      inlineData: {
        mimeType: params.mask.mimeType,
        data: params.mask.buffer.toString("base64"),
      },
    });
  }

  const resp = await geminiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
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
  const responseParts = data.candidates?.[0]?.content?.parts;

  if (!responseParts) {
    throw providerError("Gemini returned no content for image editing");
  }

  let imageResult: string | undefined;
  let revisedPrompt: string | undefined;

  for (const part of responseParts) {
    if (part.inlineData) {
      imageResult = part.inlineData.data;
    }
    if (part.text) {
      revisedPrompt = part.text;
    }
  }

  if (!imageResult) {
    throw providerError(
      "Gemini did not return image data. The model may not support image editing. " +
        "Try a model like gemini-2.0-flash-preview-image-generation.",
    );
  }

  return {
    b64_json: imageResult,
    ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
  };
}
