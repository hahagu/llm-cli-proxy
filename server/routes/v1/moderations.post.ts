import { getConvexClient } from "~~/server/utils/convex";
import { decrypt } from "~~/server/utils/crypto";
import { moderationRequestSchema } from "~~/server/utils/validation";
import { OpenAIError, invalidRequest, mapProviderHttpError, providerError } from "~~/server/utils/errors";
import { GEMINI_API_BASE, geminiFetch } from "~~/server/utils/adapters/gemini";
import { generateId } from "~~/server/utils/adapters/types";
import { api } from "~~/convex/_generated/api";

const MODERATION_MODEL = "gemini-2.0-flash";

const CATEGORIES = [
  "sexual",
  "hate",
  "harassment",
  "self-harm",
  "sexual/minors",
  "hate/threatening",
  "violence/graphic",
  "violence",
  "harassment/threatening",
  "self-harm/intent",
  "self-harm/instructions",
] as const;

const SYSTEM_PROMPT = `You are a content moderation classifier. For the given text, evaluate whether it violates any of the following categories. Return a JSON object with two fields:
- "categories": an object mapping each category name to a boolean (true if the content violates that category)
- "category_scores": an object mapping each category name to a number between 0.0 and 1.0 indicating the confidence

Categories to evaluate: ${CATEGORIES.join(", ")}

Return ONLY valid JSON, no other text.`;

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

  const parsed = moderationRequestSchema.safeParse(rawBody);
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
    // Get Gemini credentials (moderations always use Gemini)
    const convex = getConvexClient();
    const providerRecord = await convex.query(api.providers.queries.getByUserAndType, {
      userId: keyData.userId,
      type: "gemini",
    });
    if (!providerRecord) {
      throw providerError("No Gemini credentials configured. Moderations require a Gemini provider.");
    }
    const apiKey = decrypt(providerRecord.encryptedApiKey, providerRecord.keyIv);

    const model = body.model ?? MODERATION_MODEL;
    const inputs = Array.isArray(body.input) ? body.input : [body.input];

    const results = await Promise.all(
      inputs.map((input) => moderateSingleInput(model, input, apiKey)),
    );

    return {
      id: generateId(),
      model,
      results,
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

interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
}

interface GeminiModerationResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

async function moderateSingleInput(
  model: string,
  input: string,
  apiKey: string,
): Promise<ModerationResult> {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;

  const resp = await geminiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: input }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
      },
    }),
  });

  if (!resp.ok) {
    const errorBody = await resp.text();
    throw mapProviderHttpError("Gemini", resp.status, errorBody);
  }

  const data = (await resp.json()) as GeminiModerationResponse;
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("") ?? "";

  if (!text) {
    throw providerError("Gemini returned no moderation result");
  }

  try {
    const result = JSON.parse(text) as {
      categories?: Record<string, boolean>;
      category_scores?: Record<string, number>;
    };

    // Ensure all categories are present with defaults
    const categories: Record<string, boolean> = {};
    const categoryScores: Record<string, number> = {};

    for (const cat of CATEGORIES) {
      categories[cat] = result.categories?.[cat] ?? false;
      categoryScores[cat] = result.category_scores?.[cat] ?? 0;
    }

    const flagged = Object.values(categories).some((v) => v === true);

    return { flagged, categories, category_scores: categoryScores };
  } catch {
    // If Gemini returns non-JSON, return a safe default
    const categories: Record<string, boolean> = {};
    const categoryScores: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      categories[cat] = false;
      categoryScores[cat] = 0;
    }
    return { flagged: false, categories, category_scores: categoryScores };
  }
}
