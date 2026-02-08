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

    const fields: Record<string, string> = {};
    let imageData: { buffer: Buffer; mimeType: string } | undefined;

    for (const part of formData) {
      if (!part.name) continue;
      if (part.name === "image" && part.data) {
        imageData = { buffer: part.data, mimeType: part.type || "image/png" };
      } else if (part.data) {
        fields[part.name] = part.data.toString("utf-8");
      }
    }

    if (!imageData) {
      throw invalidRequest("'image' is required", "image");
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

    if (provider !== "gemini") {
      throw invalidRequest(
        `Image variations are not supported for ${provider} models. Use a Gemini image model (e.g., gemini:gemini-2.0-flash-preview-image-generation).`,
        "model",
      );
    }

    const convex = getConvexClient();
    const providerRecord = await convex.query(api.providers.queries.getByUserAndType, {
      userId: keyData.userId,
      type: "gemini",
    });
    if (!providerRecord) {
      throw providerError("No credentials configured for provider gemini");
    }
    const apiKey = decrypt(providerRecord.encryptedApiKey, providerRecord.keyIv);

    const requests = Array.from({ length: n }, () =>
      generateVariation(rawModel, imageData!, fields.size, apiKey),
    );
    const results = await Promise.all(requests);

    return {
      created: nowUnix(),
      data: results,
    };
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

async function generateVariation(
  model: string,
  image: { buffer: Buffer; mimeType: string },
  size: string | undefined,
  apiKey: string,
): Promise<{ b64_json: string; revised_prompt?: string }> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  let prompt = "Create a variation of this image. Keep the same subject and general composition but vary the style, lighting, or perspective.";
  if (size) {
    prompt += ` Generate the image at ${size} resolution.`;
  }

  const resp = await geminiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: image.mimeType,
              data: image.buffer.toString("base64"),
            },
          },
        ],
      }],
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
    throw providerError("Gemini returned no content for image variation");
  }

  let resultImage: string | undefined;
  let revisedPrompt: string | undefined;

  for (const part of parts) {
    if (part.inlineData) {
      resultImage = part.inlineData.data;
    }
    if (part.text) {
      revisedPrompt = part.text;
    }
  }

  if (!resultImage) {
    throw providerError(
      "Gemini did not return image data. The model may not support image generation. " +
        "Try a model like gemini-2.0-flash-preview-image-generation.",
    );
  }

  return {
    b64_json: resultImage,
    ...(revisedPrompt ? { revised_prompt: revisedPrompt } : {}),
  };
}
