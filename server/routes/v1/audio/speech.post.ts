import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { parseModelWithProvider } from "~~/server/utils/adapters";
import { audioSpeechRequestSchema } from "~~/server/utils/validation";
import { OpenAIError, invalidRequest, mapProviderHttpError, providerError } from "~~/server/utils/errors";
import { GEMINI_API_BASE, geminiFetch } from "~~/server/utils/adapters/gemini";
import { api } from "~~/convex/_generated/api";

// Map OpenAI voice names to Gemini prebuilt voice names
const VOICE_MAP: Record<string, string> = {
  alloy: "Kore",
  echo: "Charon",
  fable: "Aoede",
  onyx: "Fenrir",
  nova: "Puck",
  shimmer: "Leda",
};

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

  const parsed = audioSpeechRequestSchema.safeParse(rawBody);
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

    if (provider !== "gemini") {
      throw invalidRequest(
        `Text-to-speech is not supported for ${provider} models. Use a Gemini model.`,
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

    return await handleGeminiSpeech(event, rawModel, body, apiKey);
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

interface GeminiAudioResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: { mimeType: string; data: string };
      }>;
    };
  }>;
}

async function handleGeminiSpeech(
  event: Parameters<Parameters<typeof defineEventHandler>[0]>[0],
  model: string,
  body: { input: string; voice: string; response_format: string; speed?: number },
  apiKey: string,
) {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  // Map OpenAI voice name to Gemini voice, or use as-is if not in map
  const geminiVoice = VOICE_MAP[body.voice] ?? body.voice;

  const resp = await geminiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: body.input }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: geminiVoice,
            },
          },
        },
      },
    }),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw mapProviderHttpError("Gemini", resp.status, errorBody);
  }

  const data = (await resp.json()) as GeminiAudioResponse;
  const parts = data.candidates?.[0]?.content?.parts;

  if (!parts) {
    throw providerError("Gemini returned no content for speech synthesis");
  }

  let audioData: string | undefined;
  let audioMimeType = "audio/wav";

  for (const part of parts) {
    if (part.inlineData) {
      audioData = part.inlineData.data;
      audioMimeType = part.inlineData.mimeType;
    }
  }

  if (!audioData) {
    throw providerError(
      "Gemini did not return audio data. The model may not support text-to-speech.",
    );
  }

  const audioBuffer = Buffer.from(audioData, "base64");

  setHeader(event, "Content-Type", audioMimeType);
  setHeader(event, "Content-Length", audioBuffer.length);
  return audioBuffer;
}
