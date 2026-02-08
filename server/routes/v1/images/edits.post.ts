import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { parseModelWithProvider } from "~~/server/utils/adapters";
import { OpenAIError, invalidRequest, mapProviderHttpError, providerError } from "~~/server/utils/errors";
import { GEMINI_API_BASE, geminiFetch } from "~~/server/utils/adapters/gemini";
import { nowUnix } from "~~/server/utils/adapters/types";
import { api } from "~~/convex/_generated/api";

interface ParsedEditRequest {
  model: string;
  prompt: string;
  images: Array<{ base64: string; mimeType: string }>;
  mask?: { base64: string; mimeType: string };
  n: number;
  size?: string;
}

/**
 * Parse a base64 data URI or raw base64 string into components.
 */
function parseBase64Image(data: string): { base64: string; mimeType: string } | null {
  // data:image/png;base64,iVBOR...
  const dataUriMatch = data.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    return { mimeType: dataUriMatch[1]!, base64: dataUriMatch[2]! };
  }
  // Raw base64 (no prefix)
  if (data.length > 100 && !data.startsWith("http")) {
    return { mimeType: "image/png", base64: data };
  }
  return null;
}

/**
 * Parse the edit request from either multipart/form-data or JSON body.
 * Open WebUI sends multipart when engine=openai, but may also send JSON.
 */
async function parseEditRequest(event: Parameters<Parameters<typeof defineEventHandler>[0]>[0]): Promise<ParsedEditRequest> {
  const contentType = getHeader(event, "content-type") || "";
  console.log("[images/edits] Content-Type:", contentType);

  // Try multipart first
  const formData = await readMultipartFormData(event).catch((err) => {
    console.log("[images/edits] readMultipartFormData error:", err);
    return null;
  });

  console.log("[images/edits] formData parts:", formData?.length ?? "null");
  if (formData) {
    for (const part of formData) {
      console.log("[images/edits] part:", { name: part.name, filename: part.filename, type: part.type, dataLen: part.data?.length });
    }
  }

  if (formData && formData.length > 0) {
    const fields: Record<string, string> = {};
    const images: Array<{ base64: string; mimeType: string }> = [];
    let mask: { base64: string; mimeType: string } | undefined;

    for (const part of formData) {
      if (!part.name) continue;
      // Accept both "image" and "image[]" field names (Open WebUI uses "image[]" for multiple)
      if ((part.name === "image" || part.name === "image[]") && part.data) {
        images.push({
          base64: part.data.toString("base64"),
          mimeType: part.type || "image/png",
        });
      } else if (part.name === "mask" && part.data) {
        mask = {
          base64: part.data.toString("base64"),
          mimeType: part.type || "image/png",
        };
      } else if (part.data) {
        fields[part.name] = part.data.toString("utf-8");
      }
    }

    if (images.length === 0) {
      throw invalidRequest("'image' is required", "image");
    }
    if (!fields.prompt) {
      throw invalidRequest("'prompt' is required", "prompt");
    }
    if (!fields.model) {
      throw invalidRequest("'model' is required", "model");
    }

    const n = fields.n ? parseInt(fields.n, 10) : 1;
    if (isNaN(n) || n < 1 || n > 10) {
      throw invalidRequest("'n' must be an integer between 1 and 10", "n");
    }

    return { model: fields.model, prompt: fields.prompt, images, mask, n, size: fields.size };
  }

  // Fall back to JSON body (e.g., Open WebUI internal calls or other clients)
  console.log("[images/edits] Falling back to JSON body");
  let body: Record<string, unknown>;
  try {
    body = await readBody(event) as Record<string, unknown>;
    console.log("[images/edits] JSON body keys:", body ? Object.keys(body) : "null");
  } catch {
    throw invalidRequest("Request must be multipart/form-data or JSON");
  }

  if (!body || typeof body !== "object") {
    throw invalidRequest("Invalid request body");
  }

  const prompt = body.prompt as string | undefined;
  if (!prompt) {
    throw invalidRequest("'prompt' is required", "prompt");
  }

  const model = body.model as string | undefined;
  if (!model) {
    throw invalidRequest("'model' is required", "model");
  }

  // Parse image(s) from JSON - can be a single string or array of strings (base64 or data URI)
  const rawImage = body.image;
  const images: Array<{ base64: string; mimeType: string }> = [];

  if (typeof rawImage === "string") {
    const parsed = parseBase64Image(rawImage);
    if (!parsed) {
      throw invalidRequest("'image' must be a base64-encoded image or data URI", "image");
    }
    images.push(parsed);
  } else if (Array.isArray(rawImage)) {
    for (const img of rawImage) {
      if (typeof img !== "string") continue;
      const parsed = parseBase64Image(img);
      if (parsed) images.push(parsed);
    }
  }

  if (images.length === 0) {
    throw invalidRequest("'image' is required", "image");
  }

  let mask: { base64: string; mimeType: string } | undefined;
  if (typeof body.mask === "string") {
    mask = parseBase64Image(body.mask) ?? undefined;
  }

  const n = typeof body.n === "number" ? body.n : 1;
  const size = typeof body.size === "string" ? body.size : undefined;

  return { model, prompt, images, mask, n, size };
}

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
    const req = await parseEditRequest(event);

    const modelParsed = parseModelWithProvider(req.model);
    if (!modelParsed) {
      throw invalidRequest(`Cannot determine provider for model: ${req.model}`, "model");
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
      return await handleGeminiImageEdit(rawModel, req, apiKey);
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

async function handleGeminiImageEdit(
  model: string,
  req: ParsedEditRequest,
  apiKey: string,
) {
  const requests = Array.from({ length: req.n }, () =>
    editSingleImage(model, req, apiKey),
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
  req: ParsedEditRequest,
  apiKey: string,
): Promise<{ b64_json: string; revised_prompt?: string }> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  let prompt = req.prompt;
  if (req.size) {
    prompt += `\n\nGenerate the image at ${req.size} resolution.`;
  }

  // Build parts: text prompt + source image(s) + optional mask
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];

  for (const image of req.images) {
    parts.push({
      inlineData: {
        mimeType: image.mimeType,
        data: image.base64,
      },
    });
  }

  if (req.mask) {
    parts.push({
      inlineData: {
        mimeType: req.mask.mimeType,
        data: req.mask.base64,
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
