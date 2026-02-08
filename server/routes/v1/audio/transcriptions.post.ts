import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { parseModelWithProvider } from "~~/server/utils/adapters";
import { OpenAIError, invalidRequest, mapProviderHttpError, providerError } from "~~/server/utils/errors";
import { GEMINI_API_BASE, geminiFetch } from "~~/server/utils/adapters/gemini";
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
    let audioData: { buffer: Buffer; mimeType: string } | undefined;

    for (const part of formData) {
      if (!part.name) continue;
      if (part.name === "file" && part.data) {
        audioData = { buffer: part.data, mimeType: part.type || "audio/wav" };
      } else if (part.data) {
        fields[part.name] = part.data.toString("utf-8");
      }
    }

    if (!audioData) {
      throw invalidRequest("'file' is required", "file");
    }
    const model = fields.model;
    if (!model) {
      throw invalidRequest("'model' is required", "model");
    }

    const responseFormat = fields.response_format || "json";
    const language = fields.language;
    const prompt = fields.prompt;
    const temperature = fields.temperature ? parseFloat(fields.temperature) : undefined;

    const modelParsed = parseModelWithProvider(model);
    if (!modelParsed) {
      throw invalidRequest(`Cannot determine provider for model: ${model}`, "model");
    }

    const { provider, model: rawModel } = modelParsed;

    if (provider !== "gemini") {
      throw invalidRequest(
        `Audio transcription is not supported for ${provider} models. Use a Gemini model.`,
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

    return await handleGeminiTranscription(rawModel, {
      audio: audioData,
      language,
      prompt,
      temperature,
      responseFormat,
    }, apiKey);
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

interface GeminiTranscriptionResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

async function handleGeminiTranscription(
  model: string,
  params: {
    audio: { buffer: Buffer; mimeType: string };
    language?: string;
    prompt?: string;
    temperature?: number;
    responseFormat: string;
  },
  apiKey: string,
) {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  let instruction = "Transcribe the following audio accurately.";
  if (params.language) {
    instruction += ` The audio is in ${params.language}.`;
  }
  if (params.prompt) {
    instruction += ` Context: ${params.prompt}`;
  }
  instruction += " Return only the transcribed text, nothing else.";

  const generationConfig: Record<string, unknown> = {};
  if (params.temperature !== undefined) {
    generationConfig.temperature = params.temperature;
  }

  const resp = await geminiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: instruction },
          {
            inlineData: {
              mimeType: params.audio.mimeType,
              data: params.audio.buffer.toString("base64"),
            },
          },
        ],
      }],
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    }),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw mapProviderHttpError("Gemini", resp.status, errorBody);
  }

  const data = (await resp.json()) as GeminiTranscriptionResponse;
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("") ?? "";

  if (!text) {
    throw providerError("Gemini returned no transcription text");
  }

  if (params.responseFormat === "text") {
    return text;
  }

  // Default JSON format (matches OpenAI's response)
  return { text };
}
