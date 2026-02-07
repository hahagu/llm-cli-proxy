import type {
  ProviderAdapter,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIModelEntry,
} from "./types";
import { generateId, nowUnix } from "./types";
import {
  buildGeminiRequest,
  translateGeminiResponse,
  createStreamTransformer,
  createLineDecoder,
  type GeminiResponse,
} from "./gemini";

const DEFAULT_REGION = "asia-northeast1";

interface VertexCredentials {
  apiKey: string;
  projectId: string;
  region: string;
}

function parseCredentials(credential: string): VertexCredentials {
  try {
    const parsed = JSON.parse(credential);
    if (!parsed.apiKey || !parsed.projectId) {
      throw new Error("Missing apiKey or projectId");
    }
    return {
      apiKey: parsed.apiKey,
      projectId: parsed.projectId,
      region: parsed.region || DEFAULT_REGION,
    };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error("Invalid Vertex AI credentials: expected JSON with apiKey and projectId");
    }
    throw err;
  }
}

function vertexBase(region: string, projectId: string): string {
  return `https://${region}-aiplatform.googleapis.com/v1beta1/projects/${projectId}/locations/${region}`;
}

export class VertexAiAdapter implements ProviderAdapter {
  readonly name = "vertex-ai";

  async complete(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<OpenAIChatResponse> {
    const { apiKey, projectId, region } = parseCredentials(providerApiKey);
    const geminiReq = buildGeminiRequest(request);
    const url = `${vertexBase(region, projectId)}/publishers/google/models/${request.model}:generateContent?key=${apiKey}`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiReq),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Vertex AI error ${resp.status}: ${errorBody}`);
    }

    const data = (await resp.json()) as GeminiResponse;
    return translateGeminiResponse(data, request.model);
  }

  async stream(
    request: OpenAIChatRequest,
    providerApiKey: string,
  ): Promise<ReadableStream<string>> {
    const { apiKey, projectId, region } = parseCredentials(providerApiKey);
    const geminiReq = buildGeminiRequest(request);
    const url = `${vertexBase(region, projectId)}/publishers/google/models/${request.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const requestId = generateId();

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiReq),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      throw new Error(`Vertex AI error ${resp.status}: ${errorBody}`);
    }

    if (!resp.body) {
      throw new Error("No response body from Vertex AI");
    }

    return resp.body
      .pipeThrough(createLineDecoder())
      .pipeThrough(createStreamTransformer(requestId, request.model));
  }

  async listModels(providerApiKey: string): Promise<OpenAIModelEntry[]> {
    const { apiKey, region } = parseCredentials(providerApiKey);
    const url = `https://${region}-aiplatform.googleapis.com/v1beta1/publishers/google/models?key=${apiKey}`;

    const resp = await fetch(url);

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Vertex AI models list error ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as {
      models?: Array<{ name: string }>;
    };

    return (data.models ?? [])
      .map((m) => m.name.replace(/^publishers\/google\/models\//, ""))
      .filter((id) => id.includes("gemini"))
      .map((id) => ({
        id,
        object: "model" as const,
        created: nowUnix(),
        owned_by: "google-vertex-ai",
      }));
  }
}
